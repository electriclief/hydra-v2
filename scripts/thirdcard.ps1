# A third card should be a third VEN_10DE device. Is the hardware even enumerated, driver or no driver?
$ErrorActionPreference = 'Continue'
'=== every PCI device from NVIDIA, whatever class or state'
$devs = @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like 'PCI\VEN_10DE*' })
if (-not $devs.Count) { '  none' }
foreach ($d in $devs) {
  '  {0}' -f $d.FriendlyName
  '    class={0} status={1} problem={2}' -f $d.Class, $d.Status, $d.Problem
  '    {0}' -f $d.InstanceId
}
'=== any device anywhere with a problem code'
Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.Status -ne 'OK' -and $_.Class -ne 'SoftwareDevice' } |
  Sort-Object Class | ForEach-Object { '  [{0}] {1} :: {2}' -f $_.Class, $_.FriendlyName, $_.Status }
'=== PCI bus as Windows numbers it'
Get-CimInstance Win32_PnPEntity -Filter "DeviceID LIKE 'PCI%'" -ErrorAction SilentlyContinue |
  Where-Object { $_.DeviceID -like '*VEN_10DE*' } |
  ForEach-Object { '  {0}' -f $_.DeviceID }
'=== full rescan'
& pnputil /scan-devices 2>&1 | ForEach-Object { '  ' + $_.Trim() }
Start-Sleep -Seconds 20
$after = @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like 'PCI\VEN_10DE*' })
'  VEN_10DE devices after rescan: {0}' -f $after.Count
foreach ($d in $after) { '  {0} :: {1}' -f $d.FriendlyName, $d.Status }
'THIRDCARD DONE'
