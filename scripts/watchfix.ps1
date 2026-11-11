$ErrorActionPreference = 'Continue'
'=== does the script exist where the task points'
foreach ($p in 'C:\AI\tools\mining-watch.ps1', 'C:\AI\hydra-local\scripts\mining-watch.ps1') {
  '  {0}  exists={1}' -f $p, (Test-Path $p)
}
'=== repoint the task at whichever copy exists'
$src = @('C:\AI\hydra-local\scripts\mining-watch.ps1', 'C:\AI\tools\mining-watch.ps1') | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $src) { '  no copy on this node - cannot start the window'; 'WATCHFIX DONE'; exit }
'  using ' + $src
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}" -ApiPort 61235' -f $src)
$principal = New-ScheduledTaskPrincipal -UserId "$env:COMPUTERNAME\User" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'HydraMineWatch' -Action $action -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'HydraMineWatch'
Start-Sleep -Seconds 15
$i = Get-ScheduledTaskInfo -TaskName 'HydraMineWatch'
'  task state={0} lastResult={1}' -f (Get-ScheduledTask -TaskName 'HydraMineWatch').State, $i.LastTaskResult
$w = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'mining-watch' })
'  watch processes: ' + $w.Count
$w | ForEach-Object { '    pid {0} session {1}' -f $_.ProcessId, $_.SessionId }
'WATCHFIX DONE'
