$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section 'identity and boot'
Get-CimInstance Win32_ComputerSystem | ForEach-Object { '  {0} :: {1} {2}   RAM {3:N0} MB' -f $_.Name, $_.Manufacturer, $_.Model, ($_.TotalPhysicalMemory / 1MB) }
Get-CimInstance Win32_OperatingSystem | ForEach-Object { '  {0} build {1}   installed {2:yyyy-MM-dd}   up {3:N0} min' -f $_.Caption, $_.BuildNumber, $_.InstallDate, ((Get-Date) - $_.LastBootUpTime).TotalMinutes }
Get-CimInstance Win32_BaseBoard | ForEach-Object { '  board: {0} {1}  BIOS {2} {3}' -f $_.Manufacturer, $_.Product, $_.SerialNumber, (Get-CimInstance Win32_BIOS).SMBIOSBIOSVersion }
Get-CimInstance Win32_Processor | ForEach-Object { '  cpu  : {0}  {1}c/{2}t' -f $_.Name.Trim(), $_.NumberOfCores, $_.NumberOfLogicalProcessors }
Section 'storage'
Get-Disk | ForEach-Object { '  disk {0} {1,-26} {2,-6} {3,7:N0} GB  {4}' -f $_.Number, $_.FriendlyName, $_.PartitionStyle, ($_.Size/1GB), $_.BusType }
Get-Volume | Where-Object DriveLetter | ForEach-Object { '  {0}: {1,-12} {2,7:N1} GB free of {3,7:N1} GB  {4}' -f $_.DriveLetter, $_.FileSystemLabel, ($_.SizeRemaining/1GB), ($_.Size/1GB), $_.HealthStatus }
Section 'graphics'
Get-CimInstance Win32_VideoController | ForEach-Object { '  {0,-40} driver {1,-18} {2:N0} MB' -f $_.Name, $_.DriverVersion, ($_.AdapterRAM/1MB) }
$amd = @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like 'PCI\VEN_1002*' })
'  AMD PCI devices present: {0}' -f $amd.Count
$amd | ForEach-Object { '    {0}  status={1} problem={2}' -f $_.FriendlyName, $_.Status, $_.Problem }
Section 'devices with problems (new board = new hardware)'
$bad = @(Get-PnpDevice -PresentOnly -Status Error -ErrorAction SilentlyContinue)
'  devices in error: {0}' -f $bad.Count
$bad | Select-Object -First 12 | ForEach-Object { '    {0} [{1}] problem {2}' -f $_.FriendlyName, $_.Class, $_.Problem }
$unknown = @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.Class -eq $null -or $_.Status -eq 'Unknown' })
'  unknown-class devices: {0}' -f $unknown.Count
$unknown | Select-Object -First 8 | ForEach-Object { '    {0}  {1}' -f $_.FriendlyName, $_.InstanceId }
Section 'network'
Get-NetAdapter -ErrorAction SilentlyContinue | ForEach-Object { '  {0,-30} {1,-8} {2}' -f $_.InterfaceDescription, $_.Status, $_.LinkSpeed }
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch '^127' -and $_.IPAddress -notmatch '^169' } | ForEach-Object { '  {0,-16} {1}' -f $_.IPAddress, $_.InterfaceAlias }
Section 'is Hydra here'
foreach ($port in 8127, 8136, 8137) { $r = Test-NetConnection -ComputerName 127.0.0.1 -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue; '  port {0}: {1}' -f $port, $r }
Get-Process -Name electron, node -ErrorAction SilentlyContinue | Select-Object -First 5 | ForEach-Object { '  proc: {0} pid {1}' -f $_.ProcessName, $_.Id }
Section 'the old complaint: does it still power itself off'
'  uptime minutes now: ' + [math]::Round(((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalMinutes, 1)
$ev = Get-WinEvent -FilterHashtable @{LogName='System'; Id=41,6008,1074,109} -MaxEvents 6 -ErrorAction SilentlyContinue
$ev | ForEach-Object { '  {0:MM-dd HH:mm} id {1}  {2}' -f $_.TimeCreated, $_.Id, ($_.Message -split "`n")[0] }
'MAIN PROBE DONE'
