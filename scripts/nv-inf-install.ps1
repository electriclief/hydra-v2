# Install the NVIDIA display driver WITHOUT NVIDIA's installer.
# Its setup.exe produced no logs, no C:\NVIDIA tree and no driver on this stripped image - it extracts to %TEMP% and dies
# silently (the only trace was a 0 KB evb*.tmp at 13:21). So: unpack the package with 7-Zip and hand the INF to Windows
# with pnputil, which is the same thing the installer does at the end anyway, minus the UI, the telemetry and the checks
# that tiny11 broke.
$ErrorActionPreference = 'Continue'
$exe = 'C:\AI\tools\dl\nvidia-582.66.exe'
$out = 'C:\AI\tools\nv582'
$seven = 'C:\AI\tools\7zr.exe'

function Section($t) { '' ; '=== ' + $t }

Section 'preconditions'
'installer  : ' + $(if (Test-Path $exe) { '{0:N0} MB' -f ((Get-Item $exe).Length / 1MB) } else { 'MISSING' })
'disk free  : {0:N1} GB' -f ((Get-PSDrive C).Free / 1GB)
if (-not (Test-Path $exe)) { return }

Section '7-Zip standalone'
if (-not (Test-Path $seven)) {
  & curl.exe -L --fail --silent --show-error -o $seven 'https://www.7-zip.org/a/7zr.exe'
  'downloaded : ' + $(if (Test-Path $seven) { '{0:N0} KB' -f ((Get-Item $seven).Length / 1KB) } else { 'FAILED' })
} else { 'already present' }
if (-not (Test-Path $seven)) { return }

Section 'unpacking the driver package'
if (Test-Path $out) { Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force $out | Out-Null
$sw = [Diagnostics.Stopwatch]::StartNew()
& $seven x $exe ("-o" + $out) -y 2>&1 | Select-Object -Last 3
$sw.Stop()
'unpack     : {0:N0} s' -f $sw.Elapsed.TotalSeconds
$infs = @(Get-ChildItem $out -Recurse -Filter '*.inf' -ErrorAction SilentlyContinue)
'inf files  : {0}' -f $infs.Count
$infs | ForEach-Object { '  ' + $_.FullName.Replace($out, '') } | Select-Object -First 20

Section 'the display INF'
$disp = @($infs | Where-Object { $_.DirectoryName -match '(?i)Display\.Driver' })
if (-not $disp.Count) { $disp = @($infs | Where-Object { $_.Name -match '(?i)^nv.*\.inf$' }) }
if (-not $disp.Count) { 'no display INF found - package layout unexpected'; return }
$disp | ForEach-Object { '  ' + $_.Name + '  ' + [math]::Round($_.Length / 1KB, 0) + ' KB' }

Section 'does it list our cards? (1050 Ti = 1C82, 1650 = 1F82, 980 Ti = 17C8)'
foreach ($id in '1C82', '1F82', '17C8') {
  $hit = @($disp | Where-Object { (Select-String -Path $_.FullName -Pattern ('DEV_' + $id) -SimpleMatch -Quiet) -eq $true })
  '  DEV_{0} : {1}' -f $id, $(if ($hit.Count) { 'listed in ' + ($hit[0].Name) } else { 'NOT FOUND' })
}

Section 'installing with pnputil'
foreach ($d in $disp) {
  'add-driver ' + $d.Name
  & pnputil /add-driver $d.FullName /install 2>&1 | Where-Object { $_ -match '(?i)driver|error|fail|success|package' } | ForEach-Object { '  ' + $_.Trim() }
}

Section 'binding the device now'
& pnputil /scan-devices 2>&1 | Select-Object -Last 3
Start-Sleep -Seconds 8

Section 'after'
Get-PnpDevice -PresentOnly -Class Display -ErrorAction SilentlyContinue |
  ForEach-Object { '  {0,-34} {1,-8} {2}' -f $_.FriendlyName, $_.Status, $_.Problem }
if (Test-Path 'C:\Windows\System32\nvidia-smi.exe') {
  & 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=name,driver_version,memory.total --format=csv,noheader
} else { '  nvidia-smi absent (it arrives with the store/nvml part of the package - check again after a reboot)' }
'NV-INF-INSTALL DONE'
