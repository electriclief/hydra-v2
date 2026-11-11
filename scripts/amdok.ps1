# Windows now reports "AMD Radeon R9 200 Series [Display] :: OK" - something installed a driver while the package unpack failed.
# What driver is it, and does it expose Vulkan to llama.cpp?
$ErrorActionPreference = 'Continue'
'=== AMD display device and driver'
Get-PnpDevice -PresentOnly -Class Display -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like 'PCI\VEN_1002*' } |
  ForEach-Object { '  {0} :: {1}' -f $_.FriendlyName, $_.Status; '    ' + $_.InstanceId }
& pnputil /enum-devices /class Display 2>&1 | Select-String -Pattern 'AMD|Instance ID|Driver Name|Driver Version|Status|Problem' |
  Select-Object -First 24 | ForEach-Object { '  ' + $_.Line.Trim() }
'=== AMD Vulkan / OpenCL runtimes on disk'
foreach ($f in 'amdvlk64.dll', 'vulkan-1.dll', 'amdocl64.dll', 'atio6axx.dll', 'amdxx64.dll') {
  $p = Join-Path 'C:\Windows\System32' $f
  if (Test-Path $p) { '  {0,-14} {1}' -f $f, (Get-Item $p).VersionInfo.FileVersion } else { '  {0,-14} absent' -f $f }
}
'=== Vulkan ICDs registered'
$k = 'HKLM:\SOFTWARE\Khronos\OpenCL\Vendors'
if (Test-Path $k) { (Get-ItemProperty $k).PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { '  ocl: ' + $_.Name } }
foreach ($vk in 'HKLM:\SOFTWARE\Khronos\Vulkan\Drivers') {
  if (Test-Path $vk) { (Get-ItemProperty $vk).PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { '  vk:  ' + $_.Name } }
}
'=== llama device list'
& 'C:\AI\llama\llama-bench.exe' --list-devices 2>&1 | Where-Object { $_ -match 'Vulkan|ggml|error' } | ForEach-Object { '  ' + ($_ -replace "`0", '') }
'AMDOK DONE'
