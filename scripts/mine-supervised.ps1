# miner1 GPU mining supervisor.
# Why this exists: SRBMiner 3.8.0 on 580.97 sometimes loses the CUDA init race on the second card and starts at 0.00 H/s
# for good. A plain launcher leaves a card idle until somebody notices. This watches the API, and if the rig is hashing
# nothing after 90 s it restarts the miner - up to three attempts. It runs in a visible console so the share log scrolls
# where the operator can see it, and it exits cleanly on Ctrl-C.
param(
  [string]$Algorithm = 'xelishashv3',
  [string]$Pool      = 'stratum+tcp://xelishash.unmineable.com:3333',
  [string]$Wallet    = 'leafdriving2.unmineable_miner_miner1',
  [int]   $ApiPort   = 60220,
  [int]   $MaxTries  = 3,
  [int]   $WarmupSec = 90
)
$ErrorActionPreference = 'Continue'
$srb     = 'C:\AI\miners\srb380\SRBMiner-MULTI.exe'
$srbDir  = 'C:\AI\miners\srb380'
$srbLog  = 'C:\AI\logs\miner-auto.txt'
$watch   = 'C:\AI\logs\supervisor.txt'
New-Item -ItemType Directory -Force -Path 'C:\AI\logs' | Out-Null
function Log($m) { ('{0}  {1}' -f (Get-Date).ToString('HH:mm:ss'), $m) | Tee-Object -FilePath $watch -Append }

function Get-Rate {
  try {
    $a = Invoke-RestMethod ("http://127.0.0.1:$ApiPort/") -TimeoutSec 6
    return [double](@($a.algorithms)[0].hashrate.'15min')
  } catch { return -1 }
}

Log ("supervisor start: $Algorithm -> $Pool  api $ApiPort")
$attempt = 0
while ($true) {
  $attempt++
  Log "starting miner (attempt $attempt of $MaxTries)"
  $p = Start-Process -FilePath $srb -WorkingDirectory $srbDir -PassThru -NoNewWindow -ArgumentList @(
    '--algorithm', $Algorithm, '--pool', $Pool, '--wallet', $Wallet, '--disable-cpu',
    '--api-enable', '--api-port', "$ApiPort", '--gpu-sensors-disable', '--log-file', $srbLog
  )
  $warm = (Get-Date).AddSeconds($WarmupSec)
  $healthy = $false
  while ((Get-Date) -lt $warm) {
    Start-Sleep -Seconds 10
    if ($p.HasExited) { break }
    $r = Get-Rate
    if ($r -gt 0) { $healthy = $true; break }
  }
  if ($healthy) {
    Log "hashing confirmed at $r H/s - watching until it stops"
    while (-not $p.HasExited) {
      Start-Sleep -Seconds 30
      $r = Get-Rate
      if ($r -eq 0) { Log 'rate dropped to zero - restarting'; break }
    }
    if ($p.HasExited) {
      Log ('miner exited with code ' + $p.ExitCode)
    } else {
      try { Stop-Process -Id $p.Id -Force -ErrorAction Stop } catch { }
      Start-Sleep -Seconds 5
    }
  } else {
    Log 'no hashrate after warm-up - killing and retrying'
    try { Stop-Process -Id $p.Id -Force -ErrorAction Stop } catch { }
    Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 5
  }
  if ($attempt -ge $MaxTries) { Log 'attempt limit reached - stopping'; break }
}
Log 'supervisor end'
