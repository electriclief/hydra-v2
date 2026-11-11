$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }

Section 'every display device and its problem code'
Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.Class -eq 'Display' -or $_.InstanceId -like 'PCI\VEN_1002*' } | ForEach-Object {
  '  {0}' -f $_.FriendlyName
  '      status={0} problem={1}' -f $_.Status, $_.Problem
  '      {0}' -f $_.InstanceId
}

Section 'drivers bound'
& pnputil /enum-devices /class Display 2>&1 | Select-String -Pattern 'Instance ID|Device Description|Driver Name|Driver Version|Status|Problem' | Select-Object -First 40 | ForEach-Object { '  ' + $_.Line.Trim() }

Section 'the AMD card in detail (VRAM comes from the driver, not AdapterRAM)'
Get-CimInstance Win32_VideoController | ForEach-Object {
  '  {0,-38} driver {1,-18} {2}' -f $_.Name, $_.DriverVersion, $_.DriverDate
}

Section 'nvidia'
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=index,name,memory.total,utilization.gpu,power.draw --format=csv,noheader

Section 'SRBMiner devices (is ellesmere 8192 listed?)'
(& 'C:\AI\miners\srb380\SRBMiner-MULTI.exe' --list-devices 2>&1 | Where-Object { $_ -match '(?i)opencl|cuda|GPU\d' } | Select-Object -First 10) | ForEach-Object { '  ' + ($_ -replace "`0", '').Trim() }

Section 'llama devices (what a -dev list must exclude now)'
& 'C:\AI\llama\llama-bench.exe' --list-devices 2>&1 | Where-Object { $_ -match 'Found|Vulkan\d:' } | ForEach-Object { '  ' + ($_ -replace "`0", '') }

Section 'host memory'
$os = Get-CimInstance Win32_OperatingSystem
'  RAM {0:N0} MB   free {1:N0} MB   commit limit {2:N0} MB' -f ((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1MB), ($os.FreePhysicalMemory / 1KB), ($os.TotalVirtualMemorySize / 1024)

Section 'mining now'
try { $a = Invoke-RestMethod 'http://127.0.0.1:60220/' -TimeoutSec 8; $alg = @($a.algorithms)[0]; '  {0:N0} H/s  A{1} R{2}' -f $alg.hashrate.'15min', $alg.shares.accepted, $alg.shares.rejected } catch { '  api: ' + $_.Exception.Message }
'PCIE580 DONE'
