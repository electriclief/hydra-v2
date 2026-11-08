# =====================================================================================
#  BOARD-AND-BUS - which machine is this, and does its SATA controller exist as far as Windows is concerned?
#
#  The decisive question when an added drive does not appear: the OS should ALWAYS see a SATA/AHCI controller, whether or
#  not a drive is plugged into it. If there is no controller, the problem is upstream of the drive - BIOS, cabling to the
#  board, or a port shared with the M.2 slot - and looking at the drive is wasted effort.
# =====================================================================================
$ErrorActionPreference = 'Continue'

'=== board and firmware'
$bb = Get-CimInstance Win32_BaseBoard
'  board   : {0} {1}' -f $bb.Manufacturer, $bb.Product
'  bios    : {0} {1}' -f (Get-CimInstance Win32_BIOS).Manufacturer, (Get-CimInstance Win32_BIOS).SMBIOSBIOSVersion
'  system  : {0} {1}' -f (Get-CimInstance Win32_ComputerSystem).Manufacturer, (Get-CimInstance Win32_ComputerSystem).Model
''
'=== every PCI device on the bus, with its problem code (0 = fine)'
Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object Class -eq 'SCSIAdapter' | ForEach-Object {
  '  controller: {0}  status {1}' -f $_.FriendlyName, $_.Status
}
''
'=== devices with a problem code, spelled out'
$bad = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.Status -ne 'OK' }
foreach ($d in $bad) {
  $code = ''
  try { $code = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName 'DEVPKEY_Device_ProblemCode' -ErrorAction SilentlyContinue).Data } catch { }
  '  {0,-42} class {1,-14} status {2,-10} problem {3}' -f $d.FriendlyName, $d.Class, $d.Status, $code
  '    {0}' -f $d.InstanceId
}
if (-not $bad) { '  none' }
''
'=== IDE/ATA channels (empty means the OS has no ATA controller bound at all)'
$ide = Get-CimInstance Win32_IDEController -ErrorAction SilentlyContinue
if (-not $ide) { '  NONE - no ATA controller instance exists' } else { $ide | ForEach-Object { '  ' + $_.Name } }
''
'=== storage driver state'
Get-Service storahci, stornvme, iaStorAC, iaStorA -ErrorAction SilentlyContinue | ForEach-Object { '  {0,-10} {1,-9} start {2}' -f $_.Name, $_.Status, $_.StartType }
''
'=== did SetupAPI complain about a disk recently?'
$setup = Get-WinEvent -FilterHashtable @{ LogName = 'System'; StartTime = (Get-Date).AddHours(-2); ProviderName = 'Microsoft-Windows-DeviceSetupManager' } -ErrorAction SilentlyContinue
if (-not $setup) { '  none since boot' } else { $setup | Select-Object -First 6 | ForEach-Object { '  {0:HH:mm:ss} id {1} {2}' -f $_.TimeCreated, $_.Id, (($_.Message -split "`n")[0].Trim()) } }
''
'=== handle count / uptime (sanity: this is the box that just booted)'
'  uptime: ' + ((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).ToString('hh\:mm\:ss')
