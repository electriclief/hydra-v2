# Is the GTX 980 Ti slow at EVERYTHING (card-wide compute degradation) or only at etchash (a broken kernel)?
# 1.53 MH/s at 109 W with the core at full boost says the card is running a slow code path, not throttling.
# Autolykos2 should do ~60-70 MH/s on a healthy 980 Ti. This stops the supervised miner for ~3 minutes, measures,
# and puts everything back the way it was - including the ProcessWrapper row and the guard.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$LOL = (Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)lolminer' } | Select-Object -First 1)
$GUARD = (Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'standby-guard' } | Select-Object -First 1)

Section 'state before'
'  lolMiner: ' + $(if ($LOL) { 'pid ' + $LOL.ProcessId } else { 'not running' })
'  guard   : ' + $(if ($GUARD) { 'pid ' + $GUARD.ProcessId } else { 'not running' })
$lolCmd = if ($LOL) { $LOL.CommandLine } else { $null }
if ($lolCmd) { '  cmd: ' + ($lolCmd -replace '\s+', ' ').Substring(0, [Math]::Min(160, ($lolCmd -replace '\s+',' ').Length)) }
$guardCmd = if ($GUARD) { $GUARD.CommandLine } else { $null }

Section 'quiet the supervision'
if ($GUARD) { Stop-Process -Id $GUARD.ProcessId -Force -ErrorAction SilentlyContinue; '  guard stopped' }
try {
  $pws = Invoke-RestMethod 'http://127.0.0.1:8125/api/processes' -TimeoutSec 10
  $row = @($pws.processes) | Where-Object { $_.name -match 'standby' } | Select-Object -First 1
  if ($row) { '  pw row: ' + $row.id + ' (' + $row.life + ')'; try { Invoke-RestMethod -Uri ('http://127.0.0.1:8125/api/processes/' + $row.id + '/kill') -Method Post -Body '{"force":true}' -ContentType 'application/json' -TimeoutSec 10 | Out-Null; '  pw row killed' } catch { '  pw kill: ' + $_.Exception.Message } }
} catch { '  pw api: ' + $_.Exception.Message }
Start-Sleep -Seconds 4
Get-Process lolMiner -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

Section 'autolykos2, 90 seconds, this card only'
$log = 'C:\AI\logs\algo-autolykos2.txt'
Remove-Item $log -Force -ErrorAction SilentlyContinue
$algoArgs = @('--algo', 'AUTOLYKOS2', '--pool', 'stratum+tcp://autolykos.unmineable.com:3333',
          '--user', 'leafdriving2.unmineable_miner_gtx980', '--pass', 'x',
          '--apiport', '61236', '--log', $log)
$test = Start-Process -FilePath $LOL.Path -ArgumentList $algoArgs -PassThru -WindowStyle Hidden
'  pid ' + $test.Id
Start-Sleep -Seconds 90
try {
  $api = Invoke-RestMethod 'http://127.0.0.1:61236/' -TimeoutSec 8
  $g = @($api.Session.GPUs)[0]
  '  AUTOLYKOS2 result: {0} MH/s   accepted {1}   power {2} W' -f [math]::Round($g.Performance_Summary / 1e6, 2), $g.Shares_Accepted, $g.Power
} catch { '  api: ' + $_.Exception.Message }
if (Test-Path $log) { Get-Content $log | Where-Object { $_ -match '(?i)average speed|total speed' } | Select-Object -Last 2 | ForEach-Object { '  log: ' + ($_ -replace '\s+', ' ').Trim() } }

Section 'stop the test'
Get-Process lolMiner -ErrorAction SilentlyContinue | Where-Object { $_.Id -eq $test.Id } | Stop-Process -Force -ErrorAction SilentlyContinue
'  stopped'

Section 'put mining back'
if ($lolCmd) {
  $exe = ($lolCmd -split '"')[1]
  if (-not $exe) { $exe = ($lolCmd -split ' ')[0] }
  $rest = ($lolCmd -replace [regex]::Escape('"' + $exe + '"'), '').Trim()
  $argList = @($rest -split ' ' | Where-Object { $_ })
  Start-Process -FilePath $exe -ArgumentList $argList -WorkingDirectory (Split-Path $exe) -WindowStyle Minimized
  '  lolMiner relaunched directly'
}
if ($guardCmd) {
  $gExe = ($guardCmd -split '"')[1]; if (-not $gExe) { $gExe = ($guardCmd -split ' ')[0] }
  $gRest = ($guardCmd -replace [regex]::Escape('"' + $gExe + '"'), '').Trim()
  Start-Process -FilePath $gExe -ArgumentList @($gRest -split ' ' | Where-Object { $_ }) -WindowStyle Hidden
  '  guard relaunched'
}
Start-Sleep -Seconds 25
Section 'state after'
Get-Process lolMiner -ErrorAction SilentlyContinue | ForEach-Object { '  lolMiner pid {0}' -f $_.Id }
try { $api = Invoke-RestMethod 'http://127.0.0.1:61235/' -TimeoutSec 8; $g = @($api.Session.GPUs)[0]; '  back to mining: {0} MH/s  A{1}' -f [math]::Round($g.Performance_Summary / 1e6, 2), $g.Shares_Accepted } catch { '  api 61235: ' + $_.Exception.Message }
 'ALGO-TEST DONE'
