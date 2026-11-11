$ErrorActionPreference = 'Continue'
$sc = 'C:\Hydra\reliability\smartmontools\bin\smartctl.exe'
'== start short self-test'
& $sc -t short -d sat /dev/sda 2>&1 | Select-String -Pattern 'Testing has begun|Please wait|self-test' | ForEach-Object { '  ' + $_.Line.Trim() }
'== waiting 150 s for the drive to finish it'
Start-Sleep -Seconds 150
'== result'
& $sc -l selftest -d sat /dev/sda 2>&1 | Select-Object -Skip 4 | ForEach-Object { '  ' + $_.Trim() }
'== health'
& $sc -H -d sat /dev/sda 2>&1 | Select-String -Pattern 'result' | ForEach-Object { '  ' + $_.Line.Trim() }
'SELFTEST DONE'
