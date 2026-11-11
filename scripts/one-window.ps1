# Clean up the duplicate guards and the stray experiment scripts, prove there is exactly ONE miner, then put ONE window on
# the physical screen. The miner itself stays under ProcessWrapper (row: standby-miner) - it is never launched from here.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }

Section 'stray experiment scripts from C:\Windows\Temp'
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match '\\Windows\\Temp\\' } | ForEach-Object {
  '  killing pid {0}  {1}' -f $_.ProcessId, (($_.CommandLine -split ' -File ')[-1])
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

Section 'duplicate standby guards'
$guards = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'standby-guard\.ps1' } | Sort-Object ProcessId)
'  found ' + $guards.Count
if ($guards.Count -gt 1) {
  $keep = $guards[0]
  '  keeping pid ' + $keep.ProcessId + ' (oldest)'
  $guards | Select-Object -Skip 1 | ForEach-Object {
    '  stopping duplicated guard pid ' + $_.ProcessId
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
}
Start-Sleep -Seconds 4
'  guards now: ' + (@(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'standby-guard\.ps1' }).Count)

Section 'miners running'
$m = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)lol|xmrig|SRBMiner' })
'  count: ' + $m.Count
$m | ForEach-Object { '    pid {0} session {1} {2}' -f $_.ProcessId, $_.SessionId, $_.Name }
if ($m.Count -gt 1) {
  $m | Select-Object -Skip 1 | ForEach-Object { '    killing duplicate miner pid ' + $_.ProcessId; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

Section 'mining state before the window'
try {
  $a = Invoke-RestMethod 'http://127.0.0.1:61235/' -TimeoutSec 8
  '  {0:N2} MH/s  accepted {1}  rejected {2}  uptime {3:N1} h' -f (([double]$a.Algorithms[0].Total_Performance * [double]$a.Algorithms[0].Performance_Factor) / 1000000), $a.Algorithms[0].Total_Accepted, $a.Algorithms[0].Total_Rejected, ([int]$a.Session.Uptime / 3600)
} catch { '  api: ' + $_.Exception.Message }

Section 'one watch window, in the console session'
Get-ScheduledTask -TaskName 'HydraMineWatch' -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File C:\AI\tools\mining-watch.ps1 -ApiPort 61235'
$principal = New-ScheduledTaskPrincipal -UserId "$env:COMPUTERNAME\User" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'HydraMineWatch' -Action $action -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'HydraMineWatch'
Start-Sleep -Seconds 12
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'mining-watch' } | ForEach-Object { '  watch window pid {0} in session {1}' -f $_.ProcessId, $_.SessionId }
'ONE WINDOW DONE'
