$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$os = Get-CimInstance Win32_OperatingSystem
Section 'the box'
'  {0}  up {1:N0} min   last boot {2}' -f $env:COMPUTERNAME, ((Get-Date) - $os.LastBootUpTime).TotalMinutes, $os.LastBootUpTime
'  now ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
Get-CimInstance Win32_ComputerSystem | ForEach-Object { '  ram {0:N0} MB' -f ($_.TotalPhysicalMemory/1MB) }
Get-CimInstance Win32_VideoController | ForEach-Object { '  gpu {0}  driver {1}' -f $_.Name, $_.DriverVersion }
Section 'is hydra installed here'
'  C:\AI\hydra-local: ' + (Test-Path 'C:\AI\hydra-local')
foreach ($p in 'C:\AI\hydra-local\module\Menu\data\node.json','C:\AI\hydra-local\relaunch-hydra.cmd','C:\AI\hydra-local\shelf-headless.mjs') { if (Test-Path $p) { '  ' + $p + '  ' + (Get-Item $p).Length + ' B  ' + (Get-Item $p).LastWriteTime } }
if (Test-Path 'C:\AI\hydra-local\module\Menu\data\node.json') { '  ref: ' + ((Get-Content 'C:\AI\hydra-local\module\Menu\data\node.json' -Raw | ConvertFrom-Json).ref) }
Section 'what is running'
Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)node|electron|srbminer|lolminer|xmrig|llama|python' } | ForEach-Object {
  $cl = ($_.CommandLine -replace '\s+',' ')
  '  {0,-16} pid {1,-6} {2}' -f $_.Name, $_.ProcessId, $cl.Substring(0,[Math]::Min(85,$cl.Length)) }
Section 'the gpu right now'
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=name,temperature.gpu,fan.speed,power.draw,utilization.gpu,memory.used --format=csv,noheader
Section 'why it stopped: recent shutdowns and app exits'
Get-WinEvent -FilterHashtable @{LogName='System'; Id=1074,41,6008,6005} -MaxEvents 5 -ErrorAction SilentlyContinue |
  ForEach-Object { '  {0:MM-dd HH:mm} id {1}  {2}' -f $_.TimeCreated, $_.Id, ((($_.Message -split "`n")[0]) -replace '\s+',' ').Trim().Substring(0,[Math]::Min(110,((($_.Message -split "`n")[0]) -replace '\s+',' ').Trim().Length)) }
Section 'scheduled tasks for hydra / mining'
Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -match '(?i)hydra|mine|miner|standby|llm' } | ForEach-Object {
  $i = Get-ScheduledTaskInfo -TaskName $_.TaskName -TaskPath $_.TaskPath -ErrorAction SilentlyContinue
  '  {0,-22} {1,-9} logon={2} last={3} result={4}' -f $_.TaskName, $_.State, $_.Principal.LogonType, $i.LastRunTime, $i.LastTaskResult }
Section 'startup folder + autologon'
Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup" -ErrorAction SilentlyContinue | ForEach-Object { '  startup: ' + $_.Name }
$wl = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
'  AutoAdminLogon={0} ForceAutoLogon={1} user={2} password set={3}' -f $wl.AutoAdminLogon, $wl.ForceAutoLogon, $wl.DefaultUserName, [bool]$wl.DefaultPassword
& query session 2>&1 | ForEach-Object { '  ' + $_ }
'1660 CHECK DONE'
