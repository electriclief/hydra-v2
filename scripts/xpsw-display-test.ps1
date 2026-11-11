# The hypothesis, stated so it can be disproved: this card only clocks up when nothing is drawing the display.
# Measured today — 17:56 no console session, 1823 MHz SM / 96 W / 19.3 Mh/s; 19:40 a live desktop, 734/810 MHz / 22 W / 4.0 Mh/s,
# throttle reason 0x1 GpuIdle. Clock locks and persistence mode are both refused on this platform, so the test is the
# session itself: disconnect the console session (processes keep running, the display stops), measure, then reconnect.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$smi = 'C:\Windows\System32\nvidia-smi.exe'

Section '1. before — with the desktop connected'
& $smi --query-gpu=clocks.sm,clocks.mem,power.draw,pstate --format=csv,noheader
try { '  miner: {0:N2} MH/s' -f (@(Invoke-RestMethod 'http://127.0.0.1:60151/' -TimeoutSec 6).Algorithms[0].Total_Performance) } catch { '  api down' }

Section '2. disconnect the console session (no display active, processes untouched)'
& tsdiscon 1 2>&1 | ForEach-Object { '  ' + $_ }
Start-Sleep -Seconds 30

Section '3. after 30 s with no display'
& $smi --query-gpu=clocks.sm,clocks.mem,power.draw,pstate --format=csv,noheader
try { '  miner: {0:N2} MH/s' -f (@(Invoke-RestMethod 'http://127.0.0.1:60151/' -TimeoutSec 6).Algorithms[0].Total_Performance) } catch { '  api down' }
Start-Sleep -Seconds 30
& $smi --query-gpu=clocks.sm,clocks.mem,power.draw,pstate --format=csv,noheader
try { '  miner: {0:N2} MH/s' -f (@(Invoke-RestMethod 'http://127.0.0.1:60151/' -TimeoutSec 6).Algorithms[0].Total_Performance) } catch { '  api down' }

Section '4. reconnect the console session so the operator gets his screen back'
& tscon 1 /dest:console 2>&1 | ForEach-Object { '  ' + $_ }
'  sessions now:'
& query session 2>&1 | ForEach-Object { '  ' + $_ }
'XPSW DISPLAY TEST DONE'
