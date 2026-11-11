# Did the 580.97 package actually reach the store, and is anything still installing?
$ErrorActionPreference = 'Continue'
'pnputil/drvinst running : {0}' -f (@(Get-Process pnputil, DrvInst, drvinst -ErrorAction SilentlyContinue).Count)
'nv580 tree present     : {0}' -f (Test-Path 'C:\AI\tools\nv580\Display.Driver\nvaei.inf')
'--- packages matching 580.97 (32.0.15.8097)'
$raw = & pnputil /enum-drivers 2>&1
$cur = @{}; $rows = @()
foreach ($line in $raw) {
  if ($line -match '^Published Name:\s*(.+)$') { if ($cur.Count) { $rows += [pscustomobject]$cur }; $cur = @{ oem = $Matches[1].Trim() } }
  elseif ($line -match '^Original Name:\s*(.+)$') { $cur.orig = $Matches[1].Trim() }
  elseif ($line -match '^Provider Name:\s*(.+)$') { $cur.provider = $Matches[1].Trim() }
  elseif ($line -match '^Driver Version:\s*(.+)$') { $cur.version = $Matches[1].Trim() }
}
if ($cur.Count) { $rows += [pscustomobject]$cur }
$nv = @($rows | Where-Object { $_.provider -match '(?i)nvidia' })
@($nv | Where-Object { $_.version -match '15\.8097' }) | Format-Table oem, orig, version -AutoSize | Out-String -Width 100
'--- display devices and their INF'
foreach ($d in @(Get-PnpDevice -PresentOnly -Class Display -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -match '(?i)nvidia' })) {
  $inf = $null
  try { $inf = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName 'DEVPKEY_Device_DriverInfPath' -ErrorAction Stop).Data } catch { }
  '  {0,-24} {1,-8} {2,-22} {3}' -f $d.FriendlyName, $d.Status, $d.Problem, $inf
}
