# Two NVIDIA branches cannot share one Windows install: binding the 1050 Ti to 582.66 (Pascal) knocked the 1650 off to
# CM_PROB_FAILED_ADD, because nvlddmkm is a single kernel service with one version. What is needed is ONE package that
# carries both DEV_1C82 (Pascal) and DEV_1F82 (Turing) - a unified branch before the split. This tests 580.97 and, if it
# has both device ids, installs it and reports what bound.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$ver = '580.97'
$url = "https://us.download.nvidia.com/Windows/$ver/$ver-desktop-win10-win11-64bit-international-dch-whql.exe"
$exe = "C:\AI\tools\dl\nvidia-$ver.exe"
$out = "C:\AI\tools\nv580"

Section "download $ver"
if (-not (Test-Path $exe) -or (Get-Item $exe).Length -lt 800MB) {
  & curl.exe -L --retry 3 --fail --silent --show-error -o $exe $url
}
$len = if (Test-Path $exe) { (Get-Item $exe).Length } else { 0 }
'  {0:N0} MB' -f ($len / 1MB)
if ($len -lt 100MB) { 'download failed'; return }

Section 'unpack'
if (Test-Path $out) { Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force $out | Out-Null
$sw = [Diagnostics.Stopwatch]::StartNew()
& 'C:\AI\tools\7zr.exe' x $exe ("-o" + $out) -y 2>&1 | Select-Object -Last 1
'  {0:N0} s' -f $sw.Elapsed.TotalSeconds

Section 'device ids - a unified package must have BOTH'
$infs = @(Get-ChildItem $out -Recurse -Filter '*.inf' -ErrorAction SilentlyContinue)
'  inf files: {0}' -f $infs.Count
$has = @{}
foreach ($id in 'DEV_1C82', 'DEV_1F82', 'DEV_17C8', 'DEV_2182') {
  $hits = @()
  foreach ($f in $infs) {
    try { if (Select-String -Path $f.FullName -Pattern $id -SimpleMatch -Quiet) { $hits += $f.Name } } catch { }
  }
  $has[$id] = $hits.Count
  '  {0} : {1}' -f $id, $(if ($hits.Count) { 'present in ' + $hits.Count + ' file(s) e.g. ' + $hits[0] } else { 'NOT PRESENT' })
}
if (-not ($has['DEV_1C82'] -and $has['DEV_1F82'])) {
  'UNIFIED-NO - this build does not cover both Pascal and Turing; nothing installed.'
  'NV580 DONE'
  return
}

Section 'install (both ids present)'
$inf = @($infs | Where-Object { $_.Name -eq 'nvaei.inf' })[0]
if (-not $inf) { $inf = @($infs | Where-Object { $_.Name -eq 'nv_dispi.inf' })[0] }
'  inf: ' + $inf.FullName
& pnputil /add-driver $inf.FullName /install 2>&1 | ForEach-Object { '  ' + $_.Trim() }

Section 'wait for devices'
for ($i = 0; $i -lt 30; $i++) {
  $nv = @(Get-PnpDevice -PresentOnly -Class Display -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -match '(?i)nvidia' })
  $bad = @($nv | Where-Object { $_.Status -ne 'OK' })
  if ($nv.Count -ge 2 -and $bad.Count -eq 0) { '  both healthy'; break }
  Start-Sleep -Seconds 15
}
foreach ($d in @(Get-PnpDevice -PresentOnly -Class Display -ErrorAction SilentlyContinue)) {
  $infp = $null; $v = $null
  try { $infp = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName 'DEVPKEY_Device_DriverInfPath' -ErrorAction Stop).Data } catch { }
  try { $v = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName 'DEVPKEY_Device_DriverVersion' -ErrorAction Stop).Data } catch { }
  '  {0,-28} {1,-8} {2,-22} {3} {4}' -f $d.FriendlyName, $d.Status, $d.Problem, $infp, $v
}
if (Test-Path 'C:\Windows\System32\nvidia-smi.exe') {
  & 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=index,name,driver_version,memory.total,pcie.link.width.current --format=csv
}
'NV580 DONE'
