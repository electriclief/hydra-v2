# The 1650 is Turing; 582.66 is the LEGACY branch (Maxwell/Pascal/Volta) and its INFs do not contain DEV_1F82.
# Proven: 51 INFs scanned - 1C82 (1050 Ti) present in 10 files, 17C8 (980 Ti) present in 5, 1F82 absent everywhere.
# The fleet's own Turing card (gtx-1660, TU116) runs 591.86, so that is the branch Turing lives in. This stages it:
#   download → unpack with 7zr → prove DEV_1F82 is inside → pnputil the display INF → report what bound.
$ErrorActionPreference = 'Continue'
$ver = '591.86'
$url = "https://us.download.nvidia.com/Windows/$ver/$ver-desktop-win10-win11-64bit-international-dch-whql.exe"
$exe = "C:\AI\tools\dl\nvidia-$ver.exe"
$out = "C:\AI\tools\nv591"
$seven = 'C:\AI\tools\7zr.exe'

function Section($t) { '' ; '=== ' + $t }

Section "download $ver"
New-Item -ItemType Directory -Force 'C:\AI\tools\dl' | Out-Null
if (-not (Test-Path $exe) -or (Get-Item $exe).Length -lt 800MB) {
  & curl.exe -L --retry 3 --fail --silent --show-error -o $exe $url
}
'file      : ' + $(if (Test-Path $exe) { '{0:N0} MB' -f ((Get-Item $exe).Length / 1MB) } else { 'MISSING' })
'disk free : {0:N1} GB' -f ((Get-PSDrive C).Free / 1GB)
if (-not (Test-Path $exe)) { return }

Section 'unpack'
if (Test-Path $out) { Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force $out | Out-Null
$sw = [Diagnostics.Stopwatch]::StartNew()
& $seven x $exe ("-o" + $out) -y 2>&1 | Select-Object -Last 3
$sw.Stop()
'unpack    : {0:N0} s' -f $sw.Elapsed.TotalSeconds

Section 'device ids inside this package'
$infs = @(Get-ChildItem $out -Recurse -Filter '*.inf' -ErrorAction SilentlyContinue)
'inf files : {0}' -f $infs.Count
foreach ($id in '1F82', '1C82', '17C8') {
  $hit = @()
  foreach ($f in $infs) {
    try { if (Select-String -Path $f.FullName -Pattern $id -SimpleMatch -Quiet -ErrorAction Stop) { $hit += $f.Name } } catch { }
  }
  '  {0} : {1}' -f $id, $(if ($hit.Count) { 'present in ' + $hit.Count + ' file(s) e.g. ' + $hit[0] } else { 'NOT PRESENT' })
}

Section 'install the display INF'
$disp = @($infs | Where-Object { $_.Name -eq 'nv_dispi.inf' })
if (-not $disp.Count) { $disp = @($infs | Where-Object { $_.DirectoryName -match '(?i)Display\.Driver' -and $_.Name -match '^nv_dispi' }) }
if (-not $disp.Count) { 'no nv_dispi.inf - package layout unexpected'; return }
'inf       : ' + $disp[0].FullName
& pnputil /add-driver $disp[0].FullName /install 2>&1 | ForEach-Object { '  ' + $_.Trim() } | Select-Object -First 10

Section 'wait for the device'
$bound = $false
for ($i = 0; $i -lt 40; $i++) {
  $nv = @(Get-PnpDevice -PresentOnly -Class Display -ErrorAction SilentlyContinue |
      Where-Object { $_.FriendlyName -match '(?i)nvidia|geforce' -and $_.Status -eq 'OK' })
  if ($nv.Count) { $bound = $true; break }
  Start-Sleep -Seconds 20
}
if ($bound) { 'BOUND - NVIDIA display device is healthy' } else { 'not bound yet after ~13 minutes of waiting' }

Section 'final state'
foreach ($d in @(Get-PnpDevice -PresentOnly -Class Display -ErrorAction SilentlyContinue)) {
  $infp = $null
  try { $infp = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName 'DEVPKEY_Device_DriverInfPath' -ErrorAction Stop).Data } catch { }
  '  {0,-32} {1,-8} {2,-18} inf {3}' -f $d.FriendlyName, $d.Status, $d.Problem, $infp
}
if (Test-Path 'C:\Windows\System32\nvidia-smi.exe') { & 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=name,driver_version,memory.total --format=csv,noheader }
else { '  nvidia-smi absent - reboot likely needed for NVML' }
'NV591 DONE'
