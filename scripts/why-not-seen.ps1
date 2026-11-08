# =====================================================================================
#  WHY-NOT-SEEN - when a plugged-in drive does not appear, find out how far it got.
#
#  Three places a drive can die on the way to a letter, and each leaves a different trace:
#    power/cable      -> nothing at all in the PnP tree, no events
#    controller/bus   -> disk device present, or storahci errors/resets in the System log
#    partition/filesystem -> disk and partition present, no volume or a raw one
# =====================================================================================
$ErrorActionPreference = 'Continue'
$since = (Get-Date).AddHours(-1)

'=== disk-class devices in the PnP tree'
Get-PnpDevice -Class DiskDrive -ErrorAction SilentlyContinue | ForEach-Object {
  '  {0,-40} {1,-10} {2}' -f $_.FriendlyName, $_.Status, $_.InstanceId
}
''
'=== storage controllers Windows bound'
Get-PnpDevice -Class SCSIAdapter, HDC -ErrorAction SilentlyContinue | ForEach-Object {
  '  {0,-45} {1,-10} {2}' -f $_.FriendlyName, $_.Status, $_.InstanceId
}
''
'=== any device with a problem (yellow ! / unknown)'
$bad = Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object { $_.Status -ne 'OK' -and $_.Status -ne 'Unknown' -and $_.Present }
if (-not $bad) { '  none' } else {
  $bad | ForEach-Object { '  {0,-45} {1,-12} {2}' -f $_.FriendlyName, $_.Status, $_.Class }
}
''
'=== ATA/disk events in the last hour (the bus talking)'
$ev = Get-WinEvent -FilterHashtable @{ LogName = 'System'; StartTime = $since } -ErrorAction SilentlyContinue |
  Where-Object { $_.ProviderName -match 'storahci|stornvme|disk|Ntfs|volmgr|partmgr' }
if (-not $ev) { '  none' } else {
  $ev | Select-Object -First 14 | ForEach-Object {
    '  {0:HH:mm:ss} {1,-12} id {2,-5} {3}' -f $_.TimeCreated, $_.ProviderName, $_.Id, (($_.Message -split "`n")[0].Trim())
  }
}
''
'=== PCIe/SATA link info for the NVMe, and every ATA channel the OS knows'
Get-CimInstance Win32_IDEController -ErrorAction SilentlyContinue | ForEach-Object { '  ide: ' + $_.Name }
''
'=== last 12 boot-time storage decisions'
Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-Kernel-Boot' } -MaxEvents 3 -ErrorAction SilentlyContinue |
  ForEach-Object { '  {0:HH:mm:ss} {1}' -f $_.TimeCreated, (($_.Message -split "`n")[0].Trim()) }
''
'=== is the machine set to hot-plug the SATA ports? (AHCI link power / hot plug policy)'
$svc = Get-Service -Name storahci, stornvme -ErrorAction SilentlyContinue
$svc | ForEach-Object { '  {0,-12} {1}' -f $_.Name, $_.Status }
