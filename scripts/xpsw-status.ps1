# Current state of XPSW, minutes after the boot rather than seconds — the boot chain is slow on this box (PW alone took 70 s).
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$os = Get-CimInstance Win32_OperatingSystem
Section 'boot'
'  last boot {0}   up {1:N1} min   now {2}' -f $os.LastBootUpTime, ((Get-Date) - $os.LastBootUpTime).TotalMinutes, (Get-Date -Format 'HH:mm:ss')
Section 'doors'
$want = 8125,8126,8127,8128,8129,8130,8131,8132,8133,8134,8135,8136,8137,8138,8139,8144
$up = @(); foreach ($p in $want) { if (Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue) { $up += $p } }
'  {0}/{1}: {2}' -f $up.Count, $want.Count, ($up -join ' ')
Section 'windows on the console session'
Get-CimInstance Win32_Process | Where-Object { $_.Name -in 'electron.exe','powershell.exe','conhost.exe' } | Group-Object { $_.Name + ' s' + $_.SessionId } | ForEach-Object { '  {0}: {1}' -f $_.Name, $_.Count }
Section 'mining'
'  lolMiner processes: ' + @(Get-Process lolMiner -ErrorAction SilentlyContinue).Count
try {
  $a = Invoke-RestMethod 'http://127.0.0.1:60151/' -TimeoutSec 8; $alg = @($a.Algorithms)[0]
  '  {0}  {1:N2} MH/s  accepted {2}  rejected {3}  uptime {4} min' -f $alg.Algorithm, $alg.Total_Performance, $alg.Total_Accepted, $alg.Total_Rejected, [int]($a.Session.Uptime/60)
} catch { '  miner API not answering' }
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=temperature.gpu,fan.speed,power.draw,utilization.gpu --format=csv,noheader
Section 'ProcessWrapper rows of interest'
try {
  $rows = @((Invoke-RestMethod 'http://127.0.0.1:8125/api/processes' -TimeoutSec 8).processes)
  '  total rows: ' + $rows.Count
  $rows | Where-Object { $_.name -match 'standby|update|core|mirror|sessiondiary' } | ForEach-Object { '    {0,-18} {1,-9} pid {2} {3}' -f $_.name, $_.life, $_.pid, $(if ($_.error) { $_.error } else { '' }) }
} catch { '  pw not answering' }
Section 'guard log tail'
if (Test-Path 'C:\AI\hydra-local\data\standby\guard.log') { Get-Content 'C:\AI\hydra-local\data\standby\guard.log' -Tail 6 | ForEach-Object { '  ' + ($_ -replace '\s+',' ').Trim() } }
Section 'fresh screenshot'
$taskName = 'xpsw-capture-shot'
schtasks /Delete /TN $taskName /F 2>&1 | Out-Null
Remove-Item 'C:\AI\reports\xpsw-screen.png' -Force -ErrorAction SilentlyContinue
$u = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon').DefaultUserName
$act = New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\AI\hydra-local\scripts\capture-screen.ps1" -Out C:\AI\reports\xpsw-screen.png'
$pr = New-ScheduledTaskPrincipal -UserId $u -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $act -Principal $pr -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
$png = 'C:\AI\reports\xpsw-screen.png'
for ($i = 1; $i -le 15; $i++) { if ((Test-Path $png) -and (Get-Item $png).Length -gt 50000) { break }; Start-Sleep -Seconds 2 }
'  png: ' + $(if (Test-Path $png) { (Get-Item $png).Length.ToString() + ' B' } else { 'MISSING' })
'XPSW STATUS DONE'
