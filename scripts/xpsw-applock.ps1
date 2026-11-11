# The card reaches FULL speed for ~40 s after boot and then the driver drops it: measured 1911 MHz SM / 3802 MHz mem /
# 91.8 W / 19.34 Mh/s at t100s, then 746/810 / 22 W / P5 with throttle reason "Idle: Active" at t120s, and the average
# rate decays 19 -> 4 over two minutes. HW Slowdown, HW Thermal, HW Power Brake and SW Thermal are all "Not Active", so
# nothing is protecting anything — the driver is simply deciding the GPU is idle.
# The lever that exists on this platform is applications clocks (-ac). -lgc and -pm are both refused here.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$smi = 'C:\Windows\System32\nvidia-smi.exe'

Section '1. current state'
& $smi --query-gpu=clocks.sm,clocks.mem,power.draw,pstate --format=csv,noheader
'  active apps clocks: ' + ((& $smi --query-gpu=clocks.applications.sm,clocks.applications.mem --format=csv,noheader) -join '')

Section '2. ask for the card top frequency as an application clock'
$out = & $smi -ac 4004,1911 2>&1
'  -ac 4004,1911 -> ' + ($out -join ' ')

Section '3. watch it for three minutes'
for ($i = 1; $i -le 9; $i++) {
  Start-Sleep -Seconds 20
  $g = ((& $smi --query-gpu=clocks.sm,clocks.mem,power.draw,temperature.gpu,pstate --format=csv,noheader) -join '') -replace '\s+',' '
  $rate = 'api?'
  try { $rate = '{0:N2} Mh/s' -f (@(Invoke-RestMethod 'http://127.0.0.1:60151/' -TimeoutSec 5).Algorithms[0].Total_Performance) } catch { }
  '  t{0,3}s  {1}  {2}' -f ($i*20), $g, $rate
}
Section '4. throttle reasons now'
& $smi -q -d PERFORMANCE 2>&1 | Select-String -Pattern 'Performance State|Idle|Applications Clocks|HW Slowdown|Thermal|Power Brake' | Select-Object -First 8 | ForEach-Object { '  ' + $_.Line.Trim() }
'XPSW APPLOCK TEST DONE'
