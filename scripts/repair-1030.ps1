# The GT 1030 came up CM_PROB_REINSTALL while its two siblings are fine, and nvidia-smi sees only the 1650.
# Try the cheap repairs in order: rescan, then bounce that single device. Reboot only if both fail.
$ErrorActionPreference = 'Continue'
$card1030 = 'PCI\VEN_10DE&DEV_1D01&SUBSYS_85F51043&REV_A1\4&713D32&0&00E5'
function Status1030 {
  $d = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -eq $card1030 }
  if ($d) { return $d.Status } else { return 'absent' }
}
'start: ' + (Status1030)

'--- step 1: rescan'
& pnputil /scan-devices 2>&1 | ForEach-Object { '  ' + $_.Trim() }
Start-Sleep -Seconds 45
'  after rescan: ' + (Status1030)
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=index,name --format=csv,noheader

if ((Status1030) -ne 'OK') {
  '--- step 2: bounce the device'
  & pnputil /disable-device $card1030 2>&1 | ForEach-Object { '  ' + $_.Trim() }
  Start-Sleep -Seconds 15
  & pnputil /enable-device $card1030 2>&1 | ForEach-Object { '  ' + $_.Trim() }
  Start-Sleep -Seconds 45
  '  after bounce: ' + (Status1030)
  & 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=index,name --format=csv,noheader
}

'--- llama devices'
& 'C:\AI\llama\llama-bench.exe' --list-devices 2>&1 | Where-Object { $_ -match 'Vulkan|error' } | ForEach-Object { '  ' + ($_ -replace "`0", '') }
'REPAIR DONE'
