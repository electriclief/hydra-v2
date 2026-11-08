# =====================================================================================
#  ANY-STORAGE-CONTROLLER - is there ANY SATA/RAID/IDE controller in this machine, present or remembered?
#
#  Why it matters: if the controller is missing, the drive can never appear no matter what is done in Windows. Present vs
#  "Unknown" (remembered but not currently attached) is the whole difference between "BIOS has it switched off" and
#  "Windows saw it once, through a USB adapter".
# =====================================================================================
$ErrorActionPreference = 'Continue'

'=== all PCI devices Windows classifies as storage controllers (present or not)'
Get-PnpDevice -Class SCSIAdapter, HDC -ErrorAction SilentlyContinue | ForEach-Object {
  $p = ''
  try { $p = (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName 'DEVPKEY_Device_ProblemCode' -ErrorAction SilentlyContinue).Data } catch { }
  '  {0,-38} {1,-9} present {2,-6} problem {3}' -f $_.FriendlyName, $_.Status, $_.Present, $p
  '    {0}' -f $_.InstanceId
}
''
'=== anything whose name looks like SATA/AHCI/RAID/IDE, any class'
Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -match 'SATA|AHCI|RAID|IDE|Storage' } | ForEach-Object {
  '  {0,-38} {1,-9} present {2}' -f $_.FriendlyName, $_.Status, $_.Present
}
''
'=== every disk device, including ones Windows remembers but no longer sees'
Get-PnpDevice -Class DiskDrive -ErrorAction SilentlyContinue | ForEach-Object {
  $last = ''
  try { $last = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Enum\$($_.InstanceId)" -ErrorAction SilentlyContinue).'Properties' } catch { }
  '  {0,-38} status {1,-9} present {2}' -f $_.FriendlyName, $_.Status, $_.Present
  '    {0}' -f $_.InstanceId
}
''
'=== PCI class codes actually on the bus (0106 = SATA, 0104 = RAID)'
$ids = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like 'PCI\*' }
foreach ($d in $ids) {
  $cc = ''
  try { $cc = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName 'DEVPKEY_Device_ClassGuid' -ErrorAction SilentlyContinue).Data } catch { }
  if ($d.Class -in @('SCSIAdapter', 'HDC')) { '  {0} -> class {1}' -f $d.InstanceId, $d.Class }
}
''
'=== the drive that has been seen before (from the PnP memory)'
$old = Get-PnpDevice -Class DiskDrive -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -match 'ST380013|Seagate' }
if (-not $old) { '  no Seagate disk has ever been attached to this machine' } else {
  $old | ForEach-Object { '  {0}  last seen: {1}' -f $_.FriendlyName, $_.Status }
}
''
'=== USB storage the machine remembers (an adapter counts)'
Get-PnpDevice -Class USB -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -match 'Mass Storage|SCSI|UAS|Adapter' } | ForEach-Object {
  '  {0,-42} {1,-9} present {2}' -f $_.FriendlyName, $_.Status, $_.Present
}
