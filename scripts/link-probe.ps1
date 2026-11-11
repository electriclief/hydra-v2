$ErrorActionPreference = 'Continue'
$smi = 'C:\Windows\System32\nvidia-smi.exe'
'== pcie link'
(& $smi --query-gpu=pcie.link.gen.max,pcie.link.gen.current,pcie.link.width.max,pcie.link.width.current --format=csv) 2>&1 | ForEach-Object { '  ' + $_ }
'== memory + BAR1'
(& $smi -q -d MEMORY) 2>&1 | Select-String -Pattern 'Total|Used|Free|Reserved|BAR1' | Select-Object -First 8 | ForEach-Object { '  ' + $_.Line.Trim() }
'== link detail'
(& $smi -q -d PCI) 2>&1 | Select-String -Pattern 'GPU Link|PCIe Generation|Current' | Select-Object -First 8 | ForEach-Object { '  ' + $_.Line.Trim() }
'== board / slot'
Get-CimInstance Win32_VideoController | Where-Object Name -match 'NVIDIA' | ForEach-Object { '  {0}  driver {1}' -f $_.Name, $_.DriverVersion }
'LINK DONE'
