$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section 'video controllers as Windows reports them'
Get-CimInstance Win32_VideoController | ForEach-Object { '  {0,-40} {1,-18} {2:N0} MB' -f $_.Name, $_.DriverVersion, ($_.AdapterRAM / 1MB) }
Section 'the driver bound to the 580'
& pnputil /enum-drivers 2>&1 | Select-String -Pattern 'oem9.inf' -Context 0,5 | ForEach-Object { '  ' + $_.Line.Trim(); $_.Context.PostContext | ForEach-Object { '  ' + $_.Trim() } }
Section 'nvidia'
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=index,name,memory.total,utilization.gpu --format=csv,noheader
Section 'SRBMiner devices'
$d = & 'C:\AI\miners\srb380\SRBMiner-MULTI.exe' --list-devices 2>&1
$d | Where-Object { $_ -match '(?i)opencl|cuda|GPU\d|platform' } | Select-Object -First 12 | ForEach-Object { '  ' + ($_ -replace "`0", '').Trim() }
Section 'llama devices'
& 'C:\AI\llama\llama-bench.exe' --list-devices 2>&1 | Where-Object { $_ -match 'Found|Vulkan\d:' } | ForEach-Object { '  ' + ($_ -replace "`0", '') }
Section 'host memory'
$os = Get-CimInstance Win32_OperatingSystem
'  RAM {0:N0} MB  free {1:N0} MB  commit limit {2:N0} MB' -f ((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1MB), ($os.FreePhysicalMemory / 1KB), ($os.TotalVirtualMemorySize / 1024)
Section 'mining'
try { $a = Invoke-RestMethod 'http://127.0.0.1:60220/' -TimeoutSec 8; $alg = @($a.algorithms)[0]; '  {0:N0} H/s  A{1} R{2}' -f $alg.hashrate.'15min', $alg.shares.accepted, $alg.shares.rejected } catch { '  api: ' + $_.Exception.Message }
'PCIE580B DONE'
