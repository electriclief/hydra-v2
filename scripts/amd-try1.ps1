$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$amd = 'PCI\VEN_1002&DEV_6810&SUBSYS_04641043&REV_00\4&302BABE0&0&00E4'

Section 'enable the R9 again (it is the only way to measure it)'
$cur = (Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -eq $amd }).Status
'  status before: ' + $cur
if ($cur -ne 'OK') { & pnputil /enable-device $amd 2>&1 | ForEach-Object { '  ' + $_.Trim() }; Start-Sleep -Seconds 12 }
'  status after : ' + (Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -eq $amd }).Status

Section 'what lolMiner offers for choosing a device'
& 'C:\AI\miners\lolminer\lolMiner.exe' --help 2>&1 | Select-String -Pattern '(?i)device|--gpu|algo ' | Select-Object -First 14 | ForEach-Object { '  ' + $_.Line.Trim() }
'AMDTRY DONE'
