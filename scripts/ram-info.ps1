# What memory is actually in miner1 - the open question for getting two cards mining at once.
$ErrorActionPreference = 'Continue'
'=== sticks installed'
Get-CimInstance Win32_PhysicalMemory | ForEach-Object {
  '  {0,-10} {1,6} MB  {2} MT/s  {3}  {4}' -f $_.DeviceLocator, ($_.Capacity / 1MB), $_.Speed, $_.Manufacturer, $_.PartNumber
}
'=== slots the board declares'
Get-CimInstance Win32_PhysicalMemoryArray | ForEach-Object { '  slots: {0}   max capacity: {1} GB' -f $_.MemoryDevices, [math]::Round($_.MaxCapacity / 1MB) }
'=== total and free'
$os = Get-CimInstance Win32_OperatingSystem
'  visible: {0} MB   free: {1} MB' -f [math]::Round($os.TotalVisibleMemorySize / 1KB), [math]::Round($os.FreePhysicalMemory / 1KB)
'=== board'
Get-CimInstance Win32_BaseBoard | ForEach-Object { '  {0} {1}  (BIOS {2})' -f $_.Manufacturer, $_.Product, (Get-CimInstance Win32_BIOS).SMBIOSBIOSVersion }
'RAMINFO DONE'
