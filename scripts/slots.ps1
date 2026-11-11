# Which slot is which, and which of them the firmware says are in use. The new card is not on the bus, so the question
# is whether a free slot exists at all or whether it went into a slot the board does not arm.
$ErrorActionPreference = 'Continue'
'=== SMBIOS slots'
Get-CimInstance Win32_SystemSlot -ErrorAction SilentlyContinue | ForEach-Object {
  '  {0,-6} usage={1,-12} type={2,-20} width={3}' -f $_.Designation, $_.CurrentUsage, $_.SlotType, $_.SlotLength
}
'=== bus/device map from the present devices'
Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like 'PCI\VEN_10DE*' -and $_.Class -eq 'Display' } |
  ForEach-Object { '  {0} :: {1}' -f $_.FriendlyName, ($_.InstanceId -replace '.*&', ('')) }
'=== PCI bridge layout (does anything sit behind an empty bridge?)'
Get-CimInstance Win32_PnPEntity -Filter "DeviceID LIKE 'PCI%'" -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match 'PCI Express Root Port|PCI-to-PCI|PCI standard PCI' } |
  Select-Object -First 12 | ForEach-Object { '  {0,-28} {1}' -f $_.Name, $_.Status }
'SLOTS DONE'
