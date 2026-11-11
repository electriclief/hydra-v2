$ErrorActionPreference = 'Continue'
'=== oem9 package version (the driver Windows Update installed for the R9)'
& pnputil /enum-drivers 2>&1 | Select-String -Pattern 'oem9.inf' -Context 0,6 | ForEach-Object { '  ' + $_.Line.Trim(); $_.Context.PostContext | ForEach-Object { '  ' + $_.Trim() } }
'=== Vulkan ICD registrations (machine-wide)'
foreach ($k in 'HKLM:\SOFTWARE\Khronos\Vulkan\Drivers', 'HKLM:\SOFTWARE\Khronos\Vulkan\ImplicitLayers') {
  '  ' + $k
  if (Test-Path $k) { (Get-ItemProperty $k).PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { '    ' + $_.Name } } else { '    (absent)' }
}
'=== AMD vulkan DLLs anywhere in the driver store'
@(Get-ChildItem 'C:\Windows\System32\DriverStore\FileRepository' -Recurse -Filter '*vulkan*.dll' -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '(?i)ati|amd|u0' } | Select-Object -First 6) | ForEach-Object { '  {0}  {1}' -f $_.VersionInfo.FileVersion, $_.FullName }
'=== vulkaninfo-style check via llama on 3 NVIDIA only'
& 'C:\AI\llama\llama-bench.exe' --list-devices 2>&1 | Where-Object { $_ -match 'Found|Vulkan\d:' } | ForEach-Object { '  ' + ($_ -replace "`0", '') }
'AMDMETA DONE'
