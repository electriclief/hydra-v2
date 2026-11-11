# The card is running at idle clocks while hashing: CCLK 734 MHz of 1961, MCLK 810 MHz of 4004, 22 W, throttle reason
# GpuIdle. lolMiner itself reports those clocks in its own table, so this is not a reporting artefact — the memory
# clock never leaves its idle state, and etchash at 810 MHz memory is exactly the 4 MH/s we are seeing.
# Two levers, in order of least surprise: ask the driver to lock a clock, then set the Windows power plan to maximum.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$smi = 'C:\Windows\System32\nvidia-smi.exe'

Section '0. what the card says it supports'
& $smi --query-gpu=clocks.sm,clocks.mem,clocks.max.sm,clocks.max.mem,power.limit,power.default_limit,pstate --format=csv,noheader
'  gpu clocks (first 6):'
& $smi --query-supported-clocks=mem,sm --format=csv,noheader 2>&1 | Select-Object -First 6 | ForEach-Object { '    ' + $_ }

Section '1. Windows power plan -> maximum performance, and no PCIe link power saving'
& powercfg /setactive SCHEME_MIN 2>&1 | Out-Null
& powercfg /setacvalueindex SCHEME_CURRENT SUB_PCIEXPRESS ASPM 0 2>&1 | Out-Null
& powercfg /setactive SCHEME_CURRENT 2>&1 | Out-Null
'  active scheme: ' + ((& powercfg /getactivescheme) -join '')
'  ASPM setting: ' + ((& powercfg /query SCHEME_CURRENT SUB_PCIEXPRESS ASPM | Select-String 'Current AC') -join ' ')

Section '2. try to lock the core clock (this is the lever that forces P0)'
$out1 = & $smi -lgc 1600 2>&1
'  -lgc 1600 -> ' + ($out1 -join ' ')
Start-Sleep -Seconds 15
& $smi --query-gpu=clocks.sm,clocks.mem,power.draw,pstate --format=csv,noheader
try { $a = Invoke-RestMethod 'http://127.0.0.1:60151/' -TimeoutSec 6; '  miner: {0:N2} MH/s' -f (@($a.Algorithms)[0].Total_Performance) } catch { '  miner api down' }

Section '3. if the lock is refused, try persistence mode'
if ($out1 -match 'not supported|Insufficient|error|ERR') {
  $out2 = & $smi -pm 1 2>&1
  '  -pm 1 -> ' + ($out2 -join ' ')
}
Section '4. state after the attempts'
Start-Sleep -Seconds 10
& $smi --query-gpu=clocks.sm,clocks.mem,power.draw,temperature.gpu,pstate --format=csv,noheader
& $smi --query-gpu=clocks_event_reasons.active --format=csv,noheader
'XPSW CLOCK TEST DONE'
