# One window, live, read-only. It asks lolMiner's own API what it is doing and prints a line every 10 seconds,
# with a loud line whenever a share is accepted or rejected. Nothing here starts or stops the miner - ProcessWrapper
# owns it - so closing this window cannot affect the hashrate.
# It scrolls instead of clearing the screen: a Clear-Host render can composite as a black window, and a black window is
# indistinguishable from a dead miner.
param([int]$ApiPort = 61235, [string]$NodeLabel = 'gtx-980ti  ETCHASH  shares')
$ErrorActionPreference = 'Continue'
try { $Host.UI.RawUI.WindowTitle = $NodeLabel } catch { }
$minerLog = 'C:\AI\logs\lolmine.log'
$watchLog = 'C:\AI\logs\watch.log'

function Out-Line($text, $color = 'Gray') {
  try { Write-Host $text -ForegroundColor $color } catch { Write-Output $text }
  '{0}  {1}' -f (Get-Date -Format 'HH:mm:ss'), $text | Add-Content -Path $watchLog -Encoding ascii
}

New-Item -ItemType Directory -Force -Path 'C:\AI\logs' | Out-Null
Out-Line ('==== ' + $NodeLabel + '   api ' + $ApiPort + '   started ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) 'Cyan'
Out-Line '     watching only - the miner runs under ProcessWrapper' 'DarkGray'

$lastA = 0; $lastR = 0
while ($true) {
  $rate = -1; $acc = -1; $rej = -1; $up = 0
  try {
    $a = Invoke-RestMethod ("http://127.0.0.1:$ApiPort/") -TimeoutSec 8
    $rate = [double]$a.Algorithms[0].Total_Performance * [double]$a.Algorithms[0].Performance_Factor
    $acc = [int]$a.Algorithms[0].Total_Accepted
    $rej = [int]$a.Algorithms[0].Total_Rejected
    $up = [int]$a.Session.Uptime
  } catch { }

  $gpu = ''
  if (Test-Path $minerLog) {
    $g = Get-Content $minerLog -Tail 8 | Where-Object { $_ -match 'GPU\s*\d' } | Select-Object -Last 1
    if ($g) { $gpu = '  |  ' + ($g -replace '\s+', ' ').Trim() }
  }

  if ($rate -ge 0) {
    $line = '{0,7:N2} MH/s   A{1,-6} R{2,-4} up {3,5:N1} h{4}' -f ($rate / 1000000), $acc, $rej, ($up / 3600), $gpu
    Out-Line $line $(if ($rate -gt 0) { 'Green' } else { 'Yellow' })
    if ($acc -gt $lastA) {
      Out-Line ('**** SHARE ACCEPTED  +' + ($acc - $lastA) + '   total ' + $acc + '   rejected ' + $rej + ' ****') 'White'
    }
    if ($rej -gt $lastR) { Out-Line ('!!!! SHARE REJECTED  +' + ($rej - $lastR) + '   total ' + $rej + ' !!!!') 'Red' }
    $lastA = $acc; $lastR = $rej
  } else {
    Out-Line 'miner API not answering - mining may still be running' 'DarkYellow'
  }
  Start-Sleep -Seconds 10
}
