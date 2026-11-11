# After a clean boot: everything the boot contract promised, read back — and a screenshot of the actual desktop.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$os = Get-CimInstance Win32_OperatingSystem

Section 'the boot itself'
'  host {0}   last boot {1}   up {2:N1} min   now {3}' -f $env:COMPUTERNAME, $os.LastBootUpTime, ((Get-Date) - $os.LastBootUpTime).TotalMinutes, (Get-Date -Format 'HH:mm:ss')

Section 'a console session exists WITHOUT anyone typing a password'
& query session 2>&1 | ForEach-Object { '  ' + $_ }

Section 'Hydra: doors'
$want = 8125,8126,8127,8128,8129,8130,8131,8132,8133,8136,8137
$up = @()
foreach ($p in $want) {
  $c = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { $up += $p }
}
'  up: ' + ($up -join ' ') + '   ({0}/{1})' -f $up.Count, $want.Count

Section 'Hydra: the window is in the SESSION THE OPERATOR CAN SEE (1), not the service session (0)'
Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'electron.exe' } | Group-Object SessionId | ForEach-Object {
  '  electron in session {0}: {1} process(es)' -f $_.Name, $_.Count }

Section 'mining'
'  lolMiner processes: ' + @(Get-Process lolMiner -ErrorAction SilentlyContinue).Count
try {
  $a = Invoke-RestMethod 'http://127.0.0.1:60151/' -TimeoutSec 8
  $alg = @($a.Algorithms)[0]
  '  {0}  {1:N2} MH/s  accepted {2}  rejected {3}  up {4} min  pool {5}' -f $alg.Algorithm, $alg.Total_Performance, $alg.Total_Accepted, $alg.Total_Rejected, [int]($a.Session.Uptime/60), $alg.Pool
} catch { '  miner api NOT answering: ' + $_.Exception.Message }
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=temperature.gpu,fan.speed,power.draw,utilization.gpu --format=csv,noheader

Section 'the share window'
$wall = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'miner-wall' })
'  miner-wall processes: ' + $wall.Count
$wall | ForEach-Object { '    pid {0} session {1}' -f $_.ProcessId, $_.SessionId }

Section 'ProcessWrapper rows'
try {
  $r = Invoke-RestMethod 'http://127.0.0.1:8125/api/processes' -TimeoutSec 8
  $rows = @($r.processes)
  '  rows: ' + $rows.Count
  $rows | Where-Object { $_.name -match 'standby|update' } | ForEach-Object { '    {0,-16} {1,-9} pid {2}' -f $_.name, $_.life, $_.pid }
} catch { '  pw not answering' }

Section 'screenshot from the console session'
$taskName = 'xpsw-capture-shot'
$cap = 'C:\AI\hydra-local\scripts\capture-screen.ps1'
schtasks /Delete /TN $taskName /F 2>&1 | Out-Null
$u = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon').DefaultUserName
$act = New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $cap + '" -Out C:\AI\reports\xpsw-screen.png')
$pr = New-ScheduledTaskPrincipal -UserId $u -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $act -Principal $pr -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
$png = 'C:\AI\reports\xpsw-screen.png'
for ($i = 1; $i -le 12; $i++) { if ((Test-Path $png) -and (Get-Item $png).Length -gt 20000) { break }; Start-Sleep -Seconds 3 }
$info = Get-ScheduledTaskInfo -TaskName $taskName
'  task last result: ' + $info.LastTaskResult
'  png: ' + $(if (Test-Path $png) { (Get-Item $png).Length.ToString() + ' B' } else { 'MISSING' })
'XPSW BOOT VERIFY DONE'
