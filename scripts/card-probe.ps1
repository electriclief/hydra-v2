# The card bound (GTX 1650, healthy, driver 30.0.14.7280). Now: can anything actually USE it?
# A display driver and a compute stack are not the same thing - Vulkan needs an ICD, OpenCL needs nvopencl64,
# NVML needs nvml.dll. This asks the three toolchains instead of assuming.
$ErrorActionPreference = 'Continue'
'=== card'
Get-PnpDevice -PresentOnly -Class Display -ErrorAction SilentlyContinue |
  ForEach-Object { '  {0,-32} {1,-8} {2}' -f $_.FriendlyName, $_.Status, $_.Problem }
foreach ($k in 'DEVPKEY_PciDevice_CurrentLinkWidth', 'DEVPKEY_PciDevice_CurrentLinkSpeed', 'DEVPKEY_PciDevice_MaxLinkWidth', 'DEVPKEY_PciDevice_MaxLinkSpeed') {
  $d = @(Get-PnpDevice -PresentOnly -Class Display -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -match 'NVIDIA' })
  if ($d.Count) {
    try { '  {0,-32} {1}' -f ($k -replace 'DEVPKEY_PciDevice_', ''), (Get-PnpDeviceProperty -InstanceId $d[0].InstanceId -KeyName $k -ErrorAction Stop).Data } catch { }
  }
}

'=== compute stack files'
foreach ($f in 'nvml.dll', 'nvapi64.dll', 'nvopencl64.dll', 'nvoglv64.dll', 'vulkan-1.dll', 'nvcuda.dll') {
  $p = Join-Path $env:SystemRoot ('System32\' + $f)
  '  {0,-16} {1}' -f $f, $(if (Test-Path $p) { 'present ' + (Get-Item $p).VersionInfo.FileVersion } else { 'absent' })
}
$icd = @(Get-ChildItem (Join-Path $env:SystemRoot 'System32') -Filter '*vulkan*.json' -ErrorAction SilentlyContinue)
'  vulkan ICD json  : {0}' -f $(if ($icd.Count) { ($icd.Name -join ', ') } else { 'none' })

'=== llama.cpp'
$cli = 'C:\AI\llama\llama-cli.exe'
if (Test-Path $cli) { & $cli --list-devices 2>&1 | Select-Object -First 12 | ForEach-Object { '  ' + $_ } } else { '  llama-cli missing' }

'=== SRBMiner'
$srb = 'C:\AI\miners\srbminer\SRBMiner-MULTI.exe'
if (Test-Path $srb) {
  $o = & $srb --list-devices 2>&1
  ($o | Where-Object { $_ -match '(?i)gpu|opencl|cuda|device|error' } | Select-Object -First 12) | ForEach-Object { '  ' + ($_ -replace "`0", '') }
} else { '  srbminer missing' }

'=== lolMiner'
$lol = 'C:\AI\miners\lolminer\lolMiner.exe'
if (Test-Path $lol) {
  $o = & $lol --list-devices 2>&1
  ($o | Where-Object { $_ -match '(?i)device|opencl|cuda|gpu|found' } | Select-Object -First 10) | ForEach-Object { '  ' + ($_ -replace "`e\[[0-9;]*m", '') }
} else { '  lolminer missing' }
'CARD-PROBE DONE'
