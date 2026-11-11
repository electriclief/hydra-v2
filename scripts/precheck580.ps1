$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section 'mining right now (the baseline the 580 would join)'
try {
  $a = Invoke-RestMethod 'http://127.0.0.1:60220/' -TimeoutSec 8
  $alg = @($a.algorithms)[0]
  '  {0:N0} H/s   A{1} R{2}' -f $alg.hashrate.'15min', $alg.shares.accepted, $alg.shares.rejected
} catch { '  api: ' + $_.Exception.Message }
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=index,name,utilization.gpu,power.draw --format=csv,noheader
Section 'board and BIOS (does it even advertise above-4G decoding?)'
Get-CimInstance Win32_BaseBoard | ForEach-Object { '  board: {0} {1}' -f $_.Manufacturer, $_.Product }
Get-CimInstance Win32_BIOS | ForEach-Object { '  bios : {0}  {1}' -f $_.SMBIOSBIOSVersion, $_.ReleaseDate }
'  Above4GDecoding readable from OS: no - it is a setup-screen setting; Code 12 is the symptom if it is off'
Section 'memory the host has for WDDM backing'
$cs = Get-CimInstance Win32_ComputerSystem
'  RAM {0:N0} MB   free {1:N0} MB' -f ($cs.TotalPhysicalMemory / 1MB), ((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1KB)
'  commit limit {0:N0} MB' -f ((Get-CimInstance Win32_OperatingSystem).TotalVirtualMemorySize / 1024)
Section 'PCI slots currently in use and their BAR sizes'
Get-PnpDevice -PresentOnly -Class Display | ForEach-Object {
  $bar = (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName 'DEVPKEY_PciDevice_BarTypes' -ErrorAction SilentlyContinue).Data
  '  {0,-34} {1}' -f $_.FriendlyName, $_.InstanceId
}
Section 'any Code 12 / resource conflict today'
Get-PnpDevice -PresentOnly -Status Error -ErrorAction SilentlyContinue | ForEach-Object { '  ERROR {0} :: {1} ({2})' -f $_.FriendlyName, $_.Problem, $_.InstanceId }
'PRECHECK580 DONE'
