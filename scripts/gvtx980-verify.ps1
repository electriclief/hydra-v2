# Boot proof for gtx-980ti after the v1 shell was removed: does it come up as a Hydra v2 node, does mining start by
# itself, and is there a window on the console session showing the hashrate?
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$os = Get-CimInstance Win32_OperatingSystem
$wl = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'

Section 'boot'
'  boot {0}  up {1:N1} min  now {2}' -f $os.LastBootUpTime, ((Get-Date) - $os.LastBootUpTime).TotalMinutes, (Get-Date -Format 'HH:mm:ss')
'  autologon {0}  user {1}' -f $wl.AutoAdminLogon, $wl.DefaultUserName
& query session 2>&1 | ForEach-Object { '  ' + $_ }

Section 'no v1 leftovers'
'  C:\Hydra electron processes: ' + @(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { ([string]$_.ExecutablePath) -like 'C:\Hydra\*' }).Count
'  HydraGuardian Run key: ' + [bool]((Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue).PSObject.Properties.Name -contains 'HydraGuardian')
foreach ($t in 'hydra-pw-window','hydra-consoles','echidna-mine','echidna-mine-gpu') {
  $x = Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
  if ($x) { '  task {0,-20} {1}' -f $t, $x.State } else { '  task {0,-20} absent' -f $t }
}

Section 'hydra v2 windows on the console session'
Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | ForEach-Object {
  $path = [string]$_.ExecutablePath
  if ($path -like 'C:\AI\hydra-local\*') { '  v2 electron pid {0} session {1}' -f $_.ProcessId, $_.SessionId }
}
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | ForEach-Object {
  $cl = [string]$_.CommandLine
  if ($cl -match 'wall') { '  wall pid {0} session {1}' -f $_.ProcessId, $_.SessionId }
}

Section 'doors'
$want = 8125,8126,8127,8128,8129,8130,8131,8132,8133,8135,8136,8137,8138
$up = @(); foreach ($p in $want) { if (Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue) { $up += $p } }
'  {0}/{1}: {2}' -f $up.Count, $want.Count, ($up -join ' ')

Section 'mining'
'  lolMiner processes: ' + @(Get-Process lolMiner -ErrorAction SilentlyContinue).Count
try { $a = Invoke-RestMethod 'http://127.0.0.1:61235/' -TimeoutSec 8; $g = @($a.Algorithms)[0]; '  {0}  {1:N3} MH/s  A{2} R{3}  up {4} min' -f $g.Algorithm, $g.Total_Performance, $g.Total_Accepted, $g.Total_Rejected, [int]($a.Session.Uptime/60) } catch { '  miner api 61235 not answering' }
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=temperature.gpu,power.draw,utilization.gpu,clocks.sm,clocks.mem --format=csv,noheader

Section 'processwrapper rows'
try {
  $rows = @((Invoke-RestMethod 'http://127.0.0.1:8125/api/processes' -TimeoutSec 8).processes)
  '  total ' + $rows.Count
  $rows | Where-Object { $_.name -match 'standby|miner|update|wall' } | ForEach-Object { '    {0,-20} {1,-9} pid {2}' -f $_.name, $_.life, $_.pid }
} catch { '  pw not answering' }

Section 'screenshot'
$png = 'C:\AI\reports\gvtx980-screen.png'
$taskName = 'gvtx980-shot2'
schtasks /Delete /TN $taskName /F 2>&1 | Out-Null
Remove-Item $png -Force -ErrorAction SilentlyContinue
$act = New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
  -Argument '-NoProfile -ExecutionPolicy Bypass -File C:\AI\hydra-local\scripts\capture-screen.ps1 -Out C:\AI\reports\gvtx980-screen.png *> C:\AI\reports\capture.log'
$pr = New-ScheduledTaskPrincipal -UserId 'User' -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $act -Principal $pr -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
for ($i = 1; $i -le 12; $i++) { if ((Test-Path $png) -and (Get-Item $png).Length -gt 40000) { break }; Start-Sleep -Seconds 2 }
'  png: ' + $(if (Test-Path $png) { (Get-Item $png).Length.ToString() + ' B' } else { 'MISSING' })
if (-not (Test-Path $png)) { Get-Content 'C:\AI\reports\capture.log' -ErrorAction SilentlyContinue | Select-Object -First 6 | ForEach-Object { '  log: ' + $_ } }
'GVTX980 BOOT VERIFY DONE'
