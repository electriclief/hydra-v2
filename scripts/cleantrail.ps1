# The supervisor trail is unreadable because the old file was UTF-16 and the new supervisor appends UTF-8 to it.
# Restart once with a clean file - the pool loses nothing but a few seconds of hashing.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }

Section 'stop'
Stop-ScheduledTask -TaskName 'HydraMine1' -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'mine-overnight' } | ForEach-Object {
  '  stopping supervisor pid ' + $_.ProcessId
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 5

Section 'fresh trail'
Remove-Item 'C:\AI\logs\supervisor.txt' -Force -ErrorAction SilentlyContinue
Remove-Item 'C:\AI\logs\miner-auto.txt' -Force -ErrorAction SilentlyContinue

Section 'start'
Start-ScheduledTask -TaskName 'HydraMine1'
Start-Sleep -Seconds 75
'  task state: ' + (Get-ScheduledTask -TaskName 'HydraMine1').State
Get-CimInstance Win32_Process -Filter "Name='SRBMiner-MULTI.exe'" | ForEach-Object { '  SRBMiner pid {0} session {1}' -f $_.ProcessId, $_.SessionId }

Section 'trail now'
$w = 'C:\AI\logs\supervisor.txt'
if (Test-Path $w) { Get-Content $w -Encoding UTF8 | ForEach-Object { '  ' + $_ } } else { '  no file yet' }
'CLEANTRAIL DONE'
