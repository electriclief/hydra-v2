# Measured: the AMD card's Vulkan runtime (1.2.131.2, from WU driver 27.20.1034.6) accepts enumeration but dies on the first
# submit - "vkQueueSubmit: Invalid queue". Including it makes every llama.cpp run fail, so disable the adapter and keep the
# three-NVIDIA pool as the working configuration. The card stays in the slot; nothing is uninstalled.
$ErrorActionPreference = 'Continue'
$amd = 'PCI\VEN_1002&DEV_6810&SUBSYS_04641043&REV_00\4&302BABE0&0&00E4'
'current: ' + (Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -eq $amd }).Status
& pnputil /disable-device $amd 2>&1 | ForEach-Object { '  ' + $_.Trim() }
Start-Sleep -Seconds 10
'after:   ' + (Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -eq $amd }).Status
'=== llama devices now'
& 'C:\AI\llama\llama-bench.exe' --list-devices 2>&1 | Where-Object { $_ -match 'Found|Vulkan\d:' } | ForEach-Object { '  ' + ($_ -replace "`0", '') }
'=== mining devices now'
(& 'C:\AI\miners\srb380\SRBMiner-MULTI.exe' --list-devices 2>&1 | Where-Object { $_ -match '(?i)cuda devices|GPU\d' } | Select-Object -First 6) | ForEach-Object { '  ' + ($_ -replace "`0", '') }
'AMDOFF DONE'
