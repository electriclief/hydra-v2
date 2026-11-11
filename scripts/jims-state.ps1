$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section 'identity'
'  {0}   user {1}   up {2:N0} min' -f $env:COMPUTERNAME, $env:USERNAME, ((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalMinutes
'  os  : ' + (Get-CimInstance Win32_OperatingSystem).Caption + ' build ' + (Get-CimInstance Win32_OperatingSystem).BuildNumber
Get-CimInstance Win32_ComputerSystem | ForEach-Object { '  ram : {0:N0} MB   model {1} {2}' -f ($_.TotalPhysicalMemory/1MB), $_.Manufacturer, $_.Model }
Get-CimInstance Win32_Processor | ForEach-Object { '  cpu : {0}  {1}c/{2}t' -f $_.Name.Trim(), $_.NumberOfCores, $_.NumberOfLogicalProcessors }
Section 'gpu'
Get-CimInstance Win32_VideoController | ForEach-Object { '  {0,-42} driver {1}' -f $_.Name, $_.DriverVersion }
Section 'hydra on this box'
foreach ($p in 'C:\AI\hydra-local','C:\AI','C:\Hydra') { if (Test-Path $p) { '  exists: ' + $p } }
Get-ChildItem 'C:\AI\hydra-local' -ErrorAction SilentlyContinue | Select-Object -First 14 | ForEach-Object { '    ' + $_.Name }
Section 'node.json'
$nj = 'C:\AI\hydra-local\module\Menu\data\node.json'
if (Test-Path $nj) { (Get-Content $nj -Raw) -replace '\s+',' ' | ForEach-Object { '  ' + $_.Substring(0,[Math]::Min(400,$_.Length)) } } else { '  missing: ' + $nj }
Section 'hydra processes'
Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)node|electron|srbminer|lolminer|xmrig' } |
  Select-Object -First 12 | ForEach-Object {
    $cl = ($_.CommandLine -replace '\s+',' ')
    '  {0,-14} pid {1,-6} {2}' -f $_.Name, $_.ProcessId, $cl.Substring(0, [Math]::Min(105, $cl.Length))
  }
Section 'ports 8120-8150 listening'
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -ge 8120 -and $_.LocalPort -le 8150 } |
  Sort-Object LocalPort | ForEach-Object { '  {0,-6} pid {1,-6} {2}' -f $_.LocalPort, $_.OwningProcess, $_.LocalAddress }
Section 'boot chain'
$wl = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
'  AutoAdminLogon {0}  ForceAutoLogon {1}  user {2}  password set {3}' -f $wl.AutoAdminLogon, $wl.ForceAutoLogon, $wl.DefaultUserName, [bool]$wl.DefaultPassword
'  startup folder:'
Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup" -ErrorAction SilentlyContinue | ForEach-Object { '    ' + $_.Name }
'  hydra/miner tasks:'
Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -match '(?i)hydra|mine|miner|standby|guard' } | ForEach-Object {
  $i = Get-ScheduledTaskInfo -TaskName $_.TaskName -TaskPath $_.TaskPath -ErrorAction SilentlyContinue
  '    {0,-24} {1,-9} logon={2} last={3} result={4}' -f $_.TaskName, $_.State, $_.Principal.LogonType, $i.LastRunTime, $i.LastTaskResult
}
Section 'miner leftovers'
foreach ($d in 'C:\AI\miners','C:\AI\tools','C:\AI\logs') { if (Test-Path $d) { '  ' + $d + ' -> ' + (((Get-ChildItem $d -ErrorAction SilentlyContinue | Select-Object -First 8 -ExpandProperty Name) -join ', ')) } }
'  MINER_STOP: ' + (Test-Path 'C:\AI\tools\MINER_STOP')
Section 'disk'
Get-Volume -DriveLetter C | ForEach-Object { '  C: {0:N1} GB free of {1:N1} GB' -f ($_.SizeRemaining/1GB), ($_.Size/1GB) }
'JIMS STATE DONE'
