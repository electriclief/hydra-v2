# Where exactly did the R9 land, and did the two NVIDIA cards finish reinstalling?
$ErrorActionPreference = 'Continue'
'=== AMD devices, whatever Windows calls them'
Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like 'PCI\VEN_1002*' } |
  ForEach-Object { '  {0} [{1}] status={2} problem={3}' -f $_.FriendlyName, $_.Class, $_.Status, $_.Problem; '    ' + $_.InstanceId }
'=== NVIDIA display devices'
Get-PnpDevice -PresentOnly -Class Display -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like 'PCI\VEN_10DE*' } |
  ForEach-Object { '  {0} :: {1}' -f $_.FriendlyName, $_.Status }
'=== nvidia-smi'
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=index,name,pci.bus_id,memory.total --format=csv,noheader
'=== model file'
if (Test-Path 'C:\AI\models\qwen2.5-7b-q4km.gguf') { '  {0:N0} bytes of 4,683,074,240' -f (Get-Item 'C:\AI\models\qwen2.5-7b-q4km.gguf').Length } else { '  not present' }
'AMDCHECK DONE'
