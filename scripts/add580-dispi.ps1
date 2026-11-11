# The 1050 Ti will not take nvaei.inf but it DID bind nv_dispi.inf under 582.66 - so try the same INF name from 580.97.
# First prove the ids are in that file, then add it and let PnP choose.
$ErrorActionPreference = 'Continue'
$inf = 'C:\AI\tools\nv580\Display.Driver\nv_dispi.inf'
'inf exists : ' + (Test-Path $inf)
foreach ($id in 'DEV_1C82', 'DEV_1F82', 'DEV_17C8') {
  $hit = $false
  try { $hit = Select-String -Path $inf -Pattern $id -SimpleMatch -Quiet } catch { }
  '  {0} : {1}' -f $id, $(if ($hit) { 'in nv_dispi.inf' } else { 'absent' })
}
'--- ids across the package (which INF has both)'
$infs = @(Get-ChildItem 'C:\AI\tools\nv580' -Recurse -Filter '*.inf' -ErrorAction SilentlyContinue)
foreach ($f in $infs) {
  $a = $false; $b = $false
  try { $a = Select-String -Path $f.FullName -Pattern 'DEV_1C82' -SimpleMatch -Quiet } catch { }
  try { $b = Select-String -Path $f.FullName -Pattern 'DEV_1F82' -SimpleMatch -Quiet } catch { }
  if ($a -and $b) { '  BOTH: ' + $f.FullName }
}
if (Test-Path $inf) {
  '' ; '=== adding nv_dispi.inf'
  & pnputil /add-driver $inf /install 2>&1 | ForEach-Object { '  ' + $_.Trim() }
}
'=== devices'
foreach ($d in @(Get-PnpDevice -PresentOnly -Class Display -ErrorAction SilentlyContinue)) {
  $i = $null
  try { $i = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName 'DEVPKEY_Device_DriverInfPath' -ErrorAction Stop).Data } catch { }
  '  {0,-30} {1,-8} {2,-22} {3}' -f $d.FriendlyName, $d.Status, $d.Problem, $i
}
'ADDDISPI DONE'
