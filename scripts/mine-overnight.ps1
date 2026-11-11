# miner1 GPU mining supervisor - overnight build.
# Runs the miner in THIS console so its statistics and every share scroll on the physical screen, and restarts the miner if it
# comes up at 0 H/s (the intermittent CUDA init race on the second card) or dies. Never gives up unless MaxTries is set.
# Stop it by closing the window, or by creating C:\AI\tools\MINER_STOP (checked every 20 s).
param(
  [string]$Algorithm = 'xelishashv3',
  [string]$Pool      = 'stratum+tcp://xelishash.unmineable.com:3333',
  [string]$Wallet    = 'leafdriving2.unmineable_miner_miner1',
  [int]   $ApiPort   = 60220,
  [int]   $MaxTries  = 0,
  [int]   $WarmupSec = 90
)
$ErrorActionPreference = 'Continue'
$srb      = 'C:\AI\miners\srb380\SRBMiner-MULTI.exe'
$srbDir   = 'C:\AI\miners\srb380'
$srbLog   = 'C:\AI\logs\miner-auto.txt'
$watch    = 'C:\AI\logs\supervisor.txt'
$stopFile = 'C:\AI\tools\MINER_STOP'
New-Item -ItemType Directory -Force -Path 'C:\AI\logs' | Out-Null
try { $Host.UI.RawUI.WindowTitle = 'miner1  xelishashv3  shares' } catch { }

function Log($m) {
  $line = '{0}  {1}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $m
  Write-Host $line
  $line | Out-File -FilePath $watch -Append -Encoding UTF8
}

function Get-State {
  try {
    $a = Invoke-RestMethod ("http://127.0.0.1:$ApiPort/") -TimeoutSec 6
    $alg = @($a.algorithms)[0]
    [pscustomobject]@{
      Rate     = [double]$alg.hashrate.'15min'
      Accepted = [int]$alg.shares.accepted
      Rejected = [int]$alg.shares.rejected
      Ok       = $true
    }
  } catch {
    [pscustomobject]@{ Rate = -1; Accepted = 0; Rejected = 0; Ok = $false }
  }
}

Log "supervisor start  $Algorithm -> $Pool  api $ApiPort"

# A miner that will not die is not a miner that needs restarting - it is a wedged GPU context, and starting another
# SRBMiner on top of it produces the pile of orphans that made this node unrecoverable on 2026-11-10 (11 processes,
# none of them killable, all of them fighting over the same four devices). Kill, verify, escalate, and if it still
# lives, stop the loop and say so out loud instead of spawning a twelfth process.
function Stop-MinerHard {
  Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
  $left = @(Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue)
  foreach ($q in $left) { & taskkill.exe /F /T /PID $q.Id 2>&1 | Out-Null }
  Start-Sleep -Seconds 3
  $left = @(Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue)
  return @{ Clear = ($left.Count -eq 0); Remaining = $left.Count }
}

$attempt = 0
$lastAcc = 0
$lastRej = 0
while ($true) {
  if (Test-Path $stopFile) { Log 'stop file present - exiting'; break }
  $pre = Stop-MinerHard
  if (-not $pre.Clear) {
    Log ('STUCK: {0} miner process(es) will not die. The GPU context is wedged - ONE REBOOT clears it. Not starting another miner on top.' -f $pre.Remaining)
    break
  }
  $attempt++
  Log "starting miner (attempt $attempt)"
  $p = Start-Process -FilePath $srb -WorkingDirectory $srbDir -PassThru -NoNewWindow -ArgumentList @(
    '--algorithm', $Algorithm, '--pool', $Pool, '--wallet', $Wallet, '--disable-cpu',
    '--api-enable', '--api-port', "$ApiPort", '--gpu-sensors-disable', '--log-file', $srbLog
  )
  $deadline = (Get-Date).AddSeconds($WarmupSec)
  $healthy = $false
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 10
    if ($p.HasExited) { break }
    $s = Get-State
    if ($s.Rate -gt 0) {
      $healthy = $true
      Log ('hashing at {0:N0} H/s   shares A{1} R{2}' -f $s.Rate, $s.Accepted, $s.Rejected)
      break
    }
  }
  if (-not $healthy) {
    Log 'no hashrate after warm-up - restarting'
    try { Stop-Process -Id $p.Id -Force -ErrorAction Stop } catch { }
    $post = Stop-MinerHard
    if (-not $post.Clear) {
      Log ('STUCK: {0} miner process(es) will not die after a failed warm-up. Wedged GPU context - ONE REBOOT clears it.' -f $post.Remaining)
      break
    }
    if ($MaxTries -gt 0 -and $attempt -ge $MaxTries) { Log 'attempt limit reached'; break }
    continue
  }
  while (-not $p.HasExited) {
    Start-Sleep -Seconds 20
    if (Test-Path $stopFile) { break }
    $s = Get-State
    if (-not $s.Ok) { Log 'api not answering (hashing may continue)'; continue }
    if ($s.Accepted -gt $lastAcc) {
      Log ('share accepted {0} (+{1})   rate {2:N0} H/s   rejected {3}' -f $s.Accepted, ($s.Accepted - $lastAcc), $s.Rate, $s.Rejected)
      $lastAcc = $s.Accepted
    }
    if ($s.Rejected -gt $lastRej) {
      Log ('SHARE REJECTED {0} (+{1})' -f $s.Rejected, ($s.Rejected - $lastRej))
      $lastRej = $s.Rejected
    }
    if ($s.Rate -eq 0) { Log 'rate fell to zero - recycling miner'; break }
  }
  if (Test-Path $stopFile) { try { Stop-Process -Id $p.Id -Force } catch { }; Log 'stopped by flag'; break }
  if (-not $p.HasExited) { try { Stop-Process -Id $p.Id -Force -ErrorAction Stop } catch { } }
  else { Log ('miner exited with code {0}' -f $p.ExitCode) }
  Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 8
  if ($MaxTries -gt 0 -and $attempt -ge $MaxTries) { Log 'attempt limit reached'; break }
}
Log 'supervisor end'
