# =====================================================================================
#  FIX-AHCI - the SATA controller is on the bus with problem code 28 (no driver installed), which is why an added drive
#  never appears: Windows is not talking to the controller at all, so it cannot enumerate anything on it.
#
#  The driver package IS in the DriverStore (mshdc.inf_amd64_*), so this is not a download problem. This script checks the
#  package is intact, asks PnP to bind it, and reports the problem code before and after - so a failure is a fact about
#  the box, not a guess.
# =====================================================================================
$ErrorActionPreference = 'Continue'
$pkg = Get-ChildItem 'C:\Windows\System32\DriverStore\FileRepository' -Directory -Filter 'mshdc.inf_amd64_*' | Select-Object -First 1
'package: ' + $pkg.FullName
Get-ChildItem $pkg.FullName | ForEach-Object { '  {0,-16} {1,10:N0} bytes' -f $_.Name, $_.Length }
''
$dev = Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'PCI\VEN_8086&DEV_1911*' } | Select-Object -First 1
if (-not $dev) { 'the SATA controller is not present any more - something changed since the last look'; return }
$code0 = (Get-PnpDeviceProperty -InstanceId $dev.InstanceId -KeyName 'DEVPKEY_Device_ProblemCode').Data
'device: ' + $dev.FriendlyName
'  instance: ' + $dev.InstanceId
'  problem before: ' + $code0 + '  status ' + $dev.Status

''
'=== asking PnP to install the package for this device'
$inf = Join-Path $pkg.FullName 'mshdc.inf'
if (-not (Test-Path $inf)) { '  the package has no mshdc.inf - the debloater took it' ; return }
$out = & pnputil /add-driver $inf /install 2>&1
$out | ForEach-Object { '  ' + $_ }

'=== rescanning the bus'
(& pnputil /scan-devices 2>&1) | ForEach-Object { '  ' + $_ }
Start-Sleep -Seconds 4

$dev2 = Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -eq $dev.InstanceId } | Select-Object -First 1
$code1 = (Get-PnpDeviceProperty -InstanceId $dev.InstanceId -KeyName 'DEVPKEY_Device_ProblemCode').Data
'  problem after: ' + $code1 + '  status ' + $dev2.Status
''
'=== disks now'
Get-Disk | ForEach-Object { '  disk {0}  {1,8:N1} GB  {2}  {3}' -f $_.Number, ($_.Size / 1GB), $_.FriendlyName, $_.OperationalStatus }
''
'=== ATA channels now'
$ide = Get-CimInstance Win32_IDEController -ErrorAction SilentlyContinue
if (-not $ide) { '  still none' } else { $ide | ForEach-Object { '  ' + $_.Name } }
