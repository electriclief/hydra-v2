$ErrorActionPreference = 'Continue'
'=== task state'
Get-ScheduledTask -TaskName 'HydraMineWatch' -ErrorAction SilentlyContinue | ForEach-Object { '  {0} [{1}]' -f $_.TaskName, $_.State }
(Get-ScheduledTaskInfo -TaskName 'HydraMineWatch' -ErrorAction SilentlyContinue) | ForEach-Object { '  lastRun={0} lastResult={1}' -f $_.LastRunTime, $_.LastTaskResult }
'=== watch processes'
@(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'mining-watch' }) | ForEach-Object { '  pid {0} session {1} :: {2}' -f $_.ProcessId, $_.SessionId, ($_.CommandLine -replace '\s+', ' ') }
'=== run it once in the foreground to see any error'
$out = & powershell -NoProfile -ExecutionPolicy Bypass -Command "& 'C:\AI\tools\mining-watch.ps1' -ApiPort 61235" 2>&1 | Select-Object -First 12
$out | ForEach-Object { '  ' + $_ }
'VERIFY DONE'
