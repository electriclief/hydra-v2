$ErrorActionPreference = 'Continue'
'=== task state'
$t = Get-ScheduledTask -TaskName 'HydraMineWatch' -ErrorAction SilentlyContinue
if ($t) { '  {0} [{1}]' -f $t.TaskName, $t.State } else { '  task missing' }
$i = Get-ScheduledTaskInfo -TaskName 'HydraMineWatch' -ErrorAction SilentlyContinue
if ($i) { '  lastRun={0}  lastResult={1}' -f $i.LastRunTime, $i.LastTaskResult }

'=== watch processes (any session)'
$w = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'mining-watch' })
if (-not $w.Count) {
  '  none running - starting it again'
  Start-ScheduledTask -TaskName 'HydraMineWatch'
  Start-Sleep -Seconds 12
  $w = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'mining-watch' })
}
if ($w.Count) { $w | ForEach-Object { '  pid {0} session {1}' -f $_.ProcessId, $_.SessionId } }

'=== visible windows in the console session'
Get-Process | Where-Object { $_.SessionId -eq 2 -and $_.MainWindowHandle -ne 0 } | ForEach-Object { '  {0,-22} pid {1,-7} "{2}"' -f $_.ProcessName, $_.Id, $_.MainWindowTitle }

'=== miner still fine'
try {
  $a = Invoke-RestMethod 'http://127.0.0.1:61235/' -TimeoutSec 8
  '  {0:N2} MH/s  A{1} R{2}' -f (([double]$a.Algorithms[0].Total_Performance * [double]$a.Algorithms[0].Performance_Factor) / 1000000), $a.Algorithms[0].Total_Accepted, $a.Algorithms[0].Total_Rejected
} catch { '  api: ' + $_.Exception.Message }
'VERIFY DONE'
