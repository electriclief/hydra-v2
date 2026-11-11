# One window, live, read-only: it asks lolMiner's own API what it is doing and prints it.
# Nothing here starts or stops the miner - ProcessWrapper owns that - so the window can be closed at any time without
# affecting the hashrate.
param([int]$ApiPort = 61235, [string]$NodeLabel = 'gtx-980ti  ETCHASH  shares')
$ErrorActionPreference = 'Continue'
try { $Host.UI.RawUI.WindowTitle = $NodeLabel } catch { }
$log = 'C:\AI\logs\lolmine.log'

function Clear-Screen { try { Clear-Host } catch { } }

Clear-Screen
$lastA = 0; $lastR = 0; $started = Get-Date
while ($true) {
  $rate = $null; $acc = $null; $rej = $null; $up = $null; $ok = $false
  try {
    $a = Invoke-RestMethod ("http://127.0.0.1:$ApiPort/") -TimeoutSec 8
    $rate = [double]$a.Algorithms[0].Total_Performance * [double]$a.Algorithms[0].Performance_Factor
    $acc = [int]$a.Algorithms[0].Total_Accepted
    $rej = [int]$a.Algorithms[0].Total_Rejected
    $up  = [int]$a.Session.Uptime
    $ok = $true
  } catch { }

  Clear-Screen
  '  ' + $NodeLabel
  '  ' + ('-' * 62)
  if ($ok) {
    '  rate      {0,10:N2} MH/s' -f ($rate / 1000000)
    '  shares    accepted {0}   rejected {1}' -f $acc, $rej
    $d = $acc - $lastA
    if ($d -gt 0) { '  *** SHARE ACCEPTED  +' + $d + '   total ' + $acc + ' ***' }
    if ($rej -gt $lastR) { '  !!! SHARE REJECTED  +' + ($rej - $lastR) + ' !!!' }
    if ($acc -gt 0) { '  avg       {0:N1} s per share' -f ($up / $acc) }
    '  miner up  {0:N1} h' -f ($up / 3600)
    $lastA = $acc; $lastR = $rej
  } else {
    '  miner API is not answering (mining may still be running)'
  }
  '  window up {0:N0} min' -f ((Get-Date) - $started).TotalMinutes
  ''
  '  per-GPU (last line of the miner log)'
  if (Test-Path $log) {
    $g = Get-Content $log -Tail 6 | Where-Object { $_ -match 'GPU\s*\d' } | Select-Object -Last 1
    if ($g) { '    ' + $g } else { '    (no GPU line yet)' }
  } else { '    (no log at ' + $log + ')' }
  ''
  '  close this window any time - it only reads, it never stops the miner'
  Start-Sleep -Seconds 10
}
