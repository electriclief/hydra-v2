$ErrorActionPreference = 'Continue'
$c = Get-CimInstance Win32_ComputerSystem
'  RAM total: {0:N0} MB' -f ($c.TotalPhysicalMemory / 1MB)
Get-CimInstance Win32_PhysicalMemory | ForEach-Object { '  {0,6:N0} MB  slot {1}  {2} MHz  {3}' -f ($_.Capacity / 1MB), $_.DeviceLocator, $_.Speed, $_.Manufacturer }
Get-CimInstance Win32_PhysicalMemoryArray | ForEach-Object { '  slots on board: {0}   max {1:N0} MB' -f $_.MemoryDevices, ($_.MaxCapacityEx / 1024) }
$o = Get-CimInstance Win32_OperatingSystem
'  free: {0:N0} MB   commit limit {1:N0} MB' -f ($o.FreePhysicalMemory / 1KB), ($o.TotalVirtualMemorySize / 1024)
'RAM DONE'
