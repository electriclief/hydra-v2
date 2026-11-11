$ErrorActionPreference = 'Continue'
$sc = 'C:\Hydra\reliability\smartmontools\bin\smartctl.exe'
if (-not (Test-Path $sc)) { 'smartctl missing at ' + $sc; 'SMR DONE'; exit }
'  smartctl: ' + (& $sc --version | Select-Object -First 1)
'== scan'
& $sc --scan-open 2>&1 | ForEach-Object { '  ' + $_ }
'== identity / health'
$out = & $sc -i -H -d sat /dev/sda 2>&1
if (($out -join ' ') -notmatch 'Device Model|Product') { $out = & $sc -i -H -d auto /dev/sda 2>&1 }
$out | Select-String -Pattern 'Device Model|Product:|Serial Number|Firmware|User Capacity|Rotation Rate|overall-health|Health Status|SMART support' | ForEach-Object { '  ' + $_.Line.Trim() }
'== attributes'
$attr = & $sc -A -d sat /dev/sda 2>&1
if (($attr -join ' ') -notmatch 'ATTRIBUTE_NAME') { $attr = & $sc -A -d auto /dev/sda 2>&1 }
$attr | Select-String -Pattern 'ATTRIBUTE_NAME|^\s*(3|5|9|12|167|168|169|171|172|173|175|177|179|181|182|183|184|187|190|192|194|196|197|198|199|202|231|232|233|234|241|242)\s' | ForEach-Object { '  ' + ($_.Line -replace '\s+',' ').Trim() }
'== self-test log'
& $sc -l selftest -d sat /dev/sda 2>&1 | Select-Object -First 8 | ForEach-Object { '  ' + $_ }
'== short test (start)'
& $sc -t short -d sat /dev/sda 2>&1 | Select-Object -First 3 | ForEach-Object { '  ' + $_.Trim() }
'SMR DONE'
