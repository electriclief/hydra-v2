$ErrorActionPreference = 'Continue'
# replace the black-window watch with the scrolling one
Get-ScheduledTask -TaskName 'HydraMineWatch' -ErrorAction SilentlyContinue | Stop-ScheduledTask -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'mining-watch' } | ForEach-Object {
  '  stopping old watch pid ' + $_.ProcessId
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 3
$script = 'C:\AI\hydra-local\scripts\mining-window.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}" -ApiPort 61235' -f $script)
$principal = New-ScheduledTaskPrincipal -UserId "$env:COMPUTERNAME\User" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'HydraMineWatch' -Action $action -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'HydraMineWatch'
Start-Sleep -Seconds 25
'  watch processes:'
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'mining-window' } | ForEach-Object { '    pid {0} session {1}' -f $_.ProcessId, $_.SessionId }
'  watch.log tail:'
if (Test-Path 'C:\AI\logs\watch.log') { Get-Content 'C:\AI\logs\watch.log' -Tail 5 | ForEach-Object { '    ' + $_ } } else { '    (no watch.log)' }
'WINDOW2 DONE'
