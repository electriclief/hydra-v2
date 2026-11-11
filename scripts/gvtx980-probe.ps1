# gtx-980ti .134 "boots to our old menu" — find out what actually launches at logon, what is on the screen, and whether the
# v2 shelf is installed at all, before changing anything.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$os = Get-CimInstance Win32_OperatingSystem
$wl = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'

Section 'box'
'  {0}  user {1}  boot {2}  up {3:N1} min' -f $env:COMPUTERNAME, $env:USERNAME, $os.LastBootUpTime, ((Get-Date) - $os.LastBootUpTime).TotalMinutes
'  {0}' -f $os.Caption

Section 'autologon'
'  AutoAdminLogon={0}  ForceAutoLogon={1}  DefaultUserName={2}  DefaultPassword set={3}' -f $wl.AutoAdminLogon, $wl.ForceAutoLogon, $wl.DefaultUserName, [bool]$wl.DefaultPassword

Section 'interactive sessions'
& query session 2>&1 | ForEach-Object { '  ' + $_ }

Section 'startup folder'
$sh = New-Object -ComObject WScript.Shell
Get-ChildItem ([Environment]::GetFolderPath('Startup')) -ErrorAction SilentlyContinue | ForEach-Object {
  $target = ''
  if ($_.Name -like '*.lnk') { $target = $sh.CreateShortcut($_.FullName).TargetPath }
  '  {0}  ->  {1}' -f $_.Name, $target
}

Section 'run keys'
foreach ($k in 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run','HKLM:\Software\Microsoft\Windows\CurrentVersion\Run') {
  if (Test-Path $k) { (Get-ItemProperty $k).PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { '  {0}: {1} = {2}' -f $k.Split('\')[0], $_.Name, ([string]$_.Value) } }
}

Section 'tasks that fire at logon or boot'
Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.Triggers.CimClass.CimClassName -match 'Logon|Boot' } | ForEach-Object {
  $t = $_.Triggers | Select-Object -First 1
  '  {0,-28} {1,-10} {2}' -f $_.TaskName, $_.State, ($t.CimClass.CimClassName)
}

Section 'what is running'
foreach ($n in 'electron','lolMiner','SRBMiner-MULTI','xmrig','cmd','powershell','Minestatus','node') {
  $p = @(Get-CimInstance Win32_Process -Filter ("Name='" + $n + ".exe'") -ErrorAction SilentlyContinue)
  if ($p.Count) { $p | ForEach-Object { '  {0,-16} pid {1,-6} session {2}  {3}' -f $n, $_.ProcessId, $_.SessionId, (([string]$_.CommandLine) -replace '\s+',' ').Substring(0,[Math]::Min(110,(([string]$_.CommandLine) -replace '\s+',' ').Length)) } }
}

Section 'hydra install'
'  C:\AI\hydra-local exists: ' + (Test-Path 'C:\AI\hydra-local')
'  C:\AI\hydra-local\module\Basic_App exists: ' + (Test-Path 'C:\AI\hydra-local\module\Basic_App')
'  .git: ' + (Test-Path 'C:\AI\hydra-local\.git')
if (Test-Path 'C:\AI\hydra-local\module\Menu\data\node.json') { '  node.json: ' + (((Get-Content 'C:\AI\hydra-local\module\Menu\data\node.json' -Raw) -replace '\s+',' ').Substring(0,[Math]::Min(300,((Get-Content 'C:\AI\hydra-local\module\Menu\data\node.json' -Raw) -replace '\s+',' ').Length))) } else { '  node.json: MISSING' }
foreach ($d in 'C:\AI\hydra-local\tools\node\node.exe','C:\AI\hydra-local\tools\electron\electron.exe') { '  {0}: {1}' -f $d, (Test-Path $d) }

Section 'doors'
$want = 8125,8126,8127,8128,8129,8130,8131,8132,8133,8134,8135,8136,8137,8138
$up = @(); foreach ($p in $want) { if (Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue) { $up += $p } }
'  {0}/{1}: {2}' -f $up.Count, $want.Count, ($up -join ' ')
'  firewall rules for hydra: ' + @(Get-NetFirewallRule -DisplayName 'Hydra*' -ErrorAction SilentlyContinue).Count

Section 'mining'
'  miner API 60201/60202/60151: ' + (@(60201,60202,60151 | Where-Object { Get-NetTCPConnection -State Listen -LocalPort $_ -ErrorAction SilentlyContinue }) -join ',')
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=name,temperature.gpu,power.draw,utilization.gpu,clocks.sm,clocks.mem --format=csv,noheader

Section 'screenshot'
$taskName = 'gvtx980-shot'
schtasks /Delete /TN $taskName /F 2>&1 | Out-Null
Remove-Item 'C:\AI\reports\gvtx980-screen.png' -Force -ErrorAction SilentlyContinue
$act = New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\AI\hydra-local\scripts\capture-screen.ps1" -Out C:\AI\reports\gvtx980-screen.png'
$pr = New-ScheduledTaskPrincipal -UserId $wl.DefaultUserName -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $act -Principal $pr -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
for ($i = 1; $i -le 15; $i++) { if ((Test-Path 'C:\AI\reports\gvtx980-screen.png') -and (Get-Item 'C:\AI\reports\gvtx980-screen.png').Length -gt 40000) { break }; Start-Sleep -Seconds 2 }
'  png: ' + $(if (Test-Path 'C:\AI\reports\gvtx980-screen.png') { (Get-Item 'C:\AI\reports\gvtx980-screen.png').Length.ToString() + ' B' } else { 'MISSING (capture-screen.ps1 may not exist here)' })
'GVTX980 PROBE DONE'
