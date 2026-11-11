# Put the miner on the physical screen and keep it there overnight.
# A scheduled task with LogonType Interactive runs in the logged-on console session (session 1), so the supervisor's window -
# and SRBMiner's statistics and share lines inside it - is visible on miner1's own monitor. SSH-spawned processes land in
# session 0 where nobody can see them, which is why this is a task and not a remote Start-Process.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }

Section 'clean slate'
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process powershell -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $PID -and $_.SessionId -eq 1 } | ForEach-Object {
  $cl = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue).CommandLine
  if ($cl -match 'mine-overnight|mine-supervised') { '  stopping old supervisor pid ' + $_.Id; Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
}
Remove-Item 'C:\AI\tools\MINER_STOP' -Force -ErrorAction SilentlyContinue
'  done'

Section 'register the task (interactive, no time limit)'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File C:\AI\tools\mine-overnight.ps1'
$principal = New-ScheduledTaskPrincipal -UserId "$env:COMPUTERNAME\User" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 0
Register-ScheduledTask -TaskName 'HydraMine1' -Action $action -Principal $principal -Settings $settings -Force | Out-Null
$t = Get-ScheduledTask -TaskName 'HydraMine1'
'  {0} state={1} principal={2}/{3}' -f $t.TaskName, $t.State, $t.Principal.UserId, $t.Principal.LogonType

Section 'start it'
Start-ScheduledTask -TaskName 'HydraMine1'
Start-Sleep -Seconds 25
Get-ScheduledTask -TaskName 'HydraMine1' | Select-Object -ExpandProperty State | ForEach-Object { '  task state: ' + $_ }
'  supervisor processes by session:'
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | ForEach-Object { '    pid {0} session {1} :: {2}' -f $_.ProcessId, $_.SessionId, ($_.CommandLine -replace '\s+', ' ') }
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | ForEach-Object { '    SRBMiner pid {0} session {1}' -f $_.Id, $_.SessionId }
'LAUNCH DONE'
