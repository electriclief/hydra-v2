$ErrorActionPreference = 'Continue'
$script = 'C:\AI\hydra-local\scripts\shot-capture.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $script)
$principal = New-ScheduledTaskPrincipal -UserId "$env:COMPUTERNAME\User" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::FromMinutes(2))
Register-ScheduledTask -TaskName 'HydraShot' -Action $action -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'HydraShot'
Start-Sleep -Seconds 14
if (Test-Path 'C:\AI\logs\screen.log') { Get-Content 'C:\AI\logs\screen.log' } else { 'no screen.log' }
'SHOT DONE'
