# The /install pass is stuck: DriverStore flat at 12.37 GB, only 2 s of CPU per 30 s, and the 1650 sits in FAILED_ADD.
# Kill it, take every competing NVIDIA display package out of the store, then STAGE 580.97 only. A reboot lets PnP bind
# each card on its own instead of retrying against a device that is already in a failed state.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }

Section 'stop the stuck workers'
foreach ($p in @(Get-Process pnputil, DrvInst, drvinst -ErrorAction SilentlyContinue)) {
  '  killing {0} pid {1}' -f $p.ProcessName, $p.Id
  try { Stop-Process -Id $p.Id -Force -ErrorAction Stop } catch { '    ' + $_.Exception.Message }
}
Start-Sleep -Seconds 5

Section 'delete competing NVIDIA display packages'
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
'  found {0} nvidia packages' -f $nv.Count
foreach ($p in @($nv | Where-Object { $_.orig -match '(?i)^nv(aei|_dispi|ae)\.inf$' })) {
  '  deleting {0} {1} {2}' -f $p.oem, $p.orig, $p.version
  & pnputil /delete-driver $p.oem 2>&1 | ForEach-Object { '    ' + $_.Trim() }
}

Section 'stage 580.97 (no /install - the reboot does the binding)'
& pnputil /add-driver 'C:\AI\tools\nv580\Display.Driver\nvaei.inf' 2>&1 | ForEach-Object { '  ' + $_.Trim() }

Section 'store after'
$raw2 = & pnputil /enum-drivers 2>&1
$cur = @{}; $rows2 = @()
foreach ($line in $raw2) {
  if ($line -match '^Published Name:\s*(.+)$') { if ($cur.Count) { $rows2 += [pscustomobject]$cur }; $cur = @{ oem = $Matches[1].Trim() } }
  elseif ($line -match '^Original Name:\s*(.+)$') { $cur.orig = $Matches[1].Trim() }
  elseif ($line -match '^Provider Name:\s*(.+)$') { $cur.provider = $Matches[1].Trim() }
  elseif ($line -match '^Driver Version:\s*(.+)$') { $cur.version = $Matches[1].Trim() }
}
if ($cur.Count) { $rows2 += [pscustomobject]$cur }
@($rows2 | Where-Object { $_.provider -match '(?i)nvidia' }) | Sort-Object version -Descending |
  Format-Table oem, orig, version -AutoSize | Out-String -Width 100

Section 'devices (before reboot)'
foreach ($d in @(Get-PnpDevice -PresentOnly -Class Display -ErrorAction SilentlyContinue)) {
  $inf = $null
  try { $inf = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName 'DEVPKEY_Device_DriverInfPath' -ErrorAction Stop).Data } catch { }
  '  {0,-26} {1,-8} {2,-22} {3}' -f $d.FriendlyName, $d.Status, $d.Problem, $inf
}
'STAGE580 DONE'
