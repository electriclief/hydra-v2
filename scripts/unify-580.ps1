# One driver for both cards: wait for the 580.97 package add to finish, then take every OTHER NVIDIA display package out of
# the store so PnP has no older/newer branch to prefer. Only 580.97 carries both DEV_1C82 (Pascal) and DEV_1F82 (Turing).
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }

Section 'wait for the running install to settle'
for ($i = 0; $i -lt 60; $i++) {
  $n = @(Get-Process pnputil, DrvInst, drvinst -ErrorAction SilentlyContinue).Count
  if ($n -eq 0) { '  idle after {0} checks' -f $i; break }
  Start-Sleep -Seconds 20
}

Section 'store before'
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
@($nv) | Sort-Object version -Descending | Format-Table oem, orig, version -AutoSize | Out-String -Width 100

Section 'ensure 580.97 is present'
$has580 = @($nv | Where-Object { $_.version -match '15\.8097' })
if (-not $has580.Count) {
  '  adding nvaei.inf from the 580.97 tree'
  & pnputil /add-driver 'C:\AI\tools\nv580\Display.Driver\nvaei.inf' /install 2>&1 | ForEach-Object { '    ' + $_.Trim() }
} else { '  already present: ' + ($has580 | ForEach-Object { $_.oem + ' ' + $_.version }) -join ', ' }

Section 'remove competing NVIDIA display packages'
foreach ($p in @($nv | Where-Object { $_.orig -match '(?i)^nv(aei|_dispi|ae)\.inf$' -and $_.version -notmatch '15\.8097' })) {
  '  deleting {0} ({1} {2})' -f $p.oem, $p.orig, $p.version
  & pnputil /delete-driver $p.oem /uninstall 2>&1 | ForEach-Object { '    ' + $_.Trim() }
}

Section 'rescan'
& pnputil /scan-devices 2>&1 | Select-Object -Last 1 | ForEach-Object { '  ' + $_.Trim() }

Section 'devices'
for ($i = 0; $i -lt 20; $i++) {
  $nvdev = @(Get-PnpDevice -PresentOnly -Class Display -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -match '(?i)nvidia' })
  $bad = @($nvdev | Where-Object { $_.Status -ne 'OK' })
  if ($nvdev.Count -ge 2 -and $bad.Count -eq 0) { break }
  Start-Sleep -Seconds 15
}
foreach ($d in @(Get-PnpDevice -PresentOnly -Class Display -ErrorAction SilentlyContinue)) {
  $inf = $null; $v = $null
  try { $inf = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName 'DEVPKEY_Device_DriverInfPath' -ErrorAction Stop).Data } catch { }
  try { $v = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName 'DEVPKEY_Device_DriverVersion' -ErrorAction Stop).Data } catch { }
  '  {0,-26} {1,-8} {2,-22} {3} {4}' -f $d.FriendlyName, $d.Status, $d.Problem, $inf, $v
}
if (Test-Path 'C:\Windows\System32\nvidia-smi.exe') {
  & 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=index,name,driver_version,memory.total --format=csv
}
'UNIFY DONE'
