# =====================================================================================
#  CPU WALL - the second miner's own window, the same idea as the GPU wall: shares as they land, big and readable.
#
#  Reads xmrig's own API (port from node.json standby.cpu.apiPort) and the guard's log. Writes nothing, decides nothing:
#  it is a view. The point of it is that "the CPU is mining too" is a thing the operator can SEE on the node's screen,
#  not a line in a report.
#
#  Run it in a console window (Startup, or through ProcessWrapper as the cpu-wall row).
# =====================================================================================
param(
  [string]$Root = 'C:\AI\hydra-local',
  [int]$Every = 5
)
$ErrorActionPreference = 'SilentlyContinue'
try { $Host.UI.RawUI.WindowTitle = 'robert - cpu' } catch { }

$nodeJson = @(
  (Join-Path $Root 'module\Core\data\node.json'),
  (Join-Path $Root 'module\Menu\data\node.json')
) | Where-Object { Test-Path $_ } | Select-Object -First 1
$cfg = $null
if ($nodeJson) { $cfg = (Get-Content $nodeJson -Raw | ConvertFrom-Json).standby.cpu }
$port = 60131
if ($cfg -and $cfg.apiPort) { $port = [int]$cfg.apiPort }
$label = 'randomx cpu'
if ($cfg -and $cfg.label) { $label = [string]$cfg.label }

$logPath = Join-Path $Root 'data\standby\guard.log'

function Format-Rate([double]$v) {
  if ($v -ge 1e6) { return ('{0:N1} MH/s' -f ($v / 1e6)) }
  if ($v -ge 1e3) { return ('{0:N1} kH/s' -f ($v / 1e3)) }
  return ('{0:N0} H/s' -f $v)
}
function SpanSec([int]$s) {
  if ($s -ge 3600) { return ('{0}h {1}m' -f [int]($s / 3600), [int](($s % 3600) / 60)) }
  if ($s -ge 60) { return ('{0}m {1}s' -f [int]($s / 60), ($s % 60)) }
  return ('{0}s' -f $s)
}

$seenCpu = @{}
$seedOffset = 0
if (Test-Path $logPath) {
  $seedOffset = (Get-Item $logPath).Length
  # seed the panel by replaying today's CPU lines, so the window opens with a history instead of a blank screen
  Get-Content $logPath -Tail 400 | Where-Object { $_ -match 'CPU share accepted|CPU SHARE REJECTED|CPU ' } | ForEach-Object {
    $key = $_.Trim()
    if (-not $seenCpu.ContainsKey($key)) { $seenCpu[$key] = $true }
  }
}

Clear-Host
$startedAt = Get-Date
while ($true) {
  $now = Get-Date
  $s = $null
  try { $s = Invoke-RestMethod ("http://127.0.0.1:" + $port + "/2/summary") -TimeoutSec 3 } catch { }

  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add('')
  $lines.Add('   ROBERT  -  CPU  ' + $label.ToUpper())
  $lines.Add('   ' + ('-' * 62))
  if (-not $s) {
    $lines.Add('   xmrig is not answering on 127.0.0.1:' + $port)
    $lines.Add('   the CPU is free: either the card has the box, or the miner is not up.')
  } else {
    $rate = 0
    if ($s.hashrate.total) {
      $slots = @($s.hashrate.total)
      if ($slots.Count -ge 2 -and [double]$slots[1] -gt 0) { $rate = [double]$slots[1] }
      elseif ([double]$slots[0] -gt 0) { $rate = [double]$slots[0] }
    }
    $good = 0; $all = 0
    if ($s.results) { $good = [int]$s.results.shares_good; $all = [int]$s.results.shares_total }
    # xmrig's cpu.threads is the COUNT OF CORES on the box, not what this miner is using - ask the declaration
    $cores = 0
    if ($s.cpu.threads) { $cores = [int]$s.cpu.threads }
    $used = if ($cfg -and $cfg.threads) { [int]$cfg.threads } else { 0 }
    $up = [int]$s.uptime

    $lines.Add(('   rate      {0,-14} up {1,-12} threads {2}' -f (Format-Rate $rate), (SpanSec $up), $(if ($used) { "$used of $cores" } else { "$cores" })))
    $lines.Add(('   accepted  {0,-14} rejected {1,-10} pool {2}' -f $good, ($all - $good), $s.connection.pool))
    $lines.Add('   ' + ('-' * 62))
    $lines.Add('   ' + $now.ToString('HH:mm:ss') + '   ' + $label + '  ' + (Format-Rate $rate))
    $lines.Add('')
    $lines.Add('   SHARES')
    $recent = @($seenCpu.Keys)
    if ($recent.Count -eq 0) {
      $lines.Add('     no CPU share yet - at ~530 H/s a share takes about 3 minutes')
    } else {
      $i = 0
      foreach ($k in ($recent | Select-Object -Last 12)) {
        $lines.Add('     ' + $k)
        $i++
      }
    }
  }
  $lines.Add('')
  $lines.Add('   (view only - nothing here starts or stops a miner)')

  # new guard lines since the last pass
  if (Test-Path $logPath) {
    try {
      $fs = [System.IO.File]::Open($logPath, 'Open', 'Read', 'ReadWrite')
      if ($fs.Length -gt $seedOffset) {
        $fs.Position = $seedOffset
        $reader = New-Object System.IO.StreamReader($fs)
        $chunk = $reader.ReadToEnd()
        $seedOffset = $fs.Position
        $reader.Close(); $fs.Close()
        foreach ($line in ($chunk -split "`n")) {
          $t = $line.Trim()
          if (-not $t) { continue }
          if ($t -match 'CPU share accepted|CPU SHARE REJECTED|CPU\s') { $seenCpu[$t] = $true }
        }
      } else { $fs.Close() }
    } catch { }
  }

  Clear-Host
  $lines | ForEach-Object { Write-Host $_ }
  Start-Sleep -Seconds $Every
}
