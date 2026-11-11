# The pattern after every reset: full speed for ~40 s at 91.8 W, then a drop to 22 W and idle clocks that never lifts,
# with HW Slowdown / HW Thermal / HW Power Brake all "Not Active". That is not a thermal or driver policy decision — it
# looks like the card browning out when it actually pulls power, which is what a half-seated 6-pin after a move does.
# The test: cap it below the point where it falls over and see whether it then holds its rate instead of collapsing.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$smi = 'C:\Windows\System32\nvidia-smi.exe'

Section '1. power limits the card will accept'
& $smi --query-gpu=power.min_limit,power.limit,power.default_limit,power.max_limit,enforced.power.limit --format=csv,noheader

Section '2. restart the miner cleanly, capped at 80 W'
try { @(Invoke-RestMethod 'http://127.0.0.1:8125/api/processes' -TimeoutSec 8).processes | Where-Object { $_.name -eq 'standby-miner' } | ForEach-Object { Invoke-RestMethod -Method Post -Uri ('http://127.0.0.1:8125/api/processes/' + $_.id + '/kill') -Body '{"force":true}' -ContentType 'application/json' -TimeoutSec 15 | Out-Null } } catch { }
Get-Process lolMiner -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 6
$cap = & $smi -pl 80 2>&1
'  -pl 80 -> ' + ($cap -join ' ')
Start-Sleep -Seconds 3
& $smi --query-gpu=power.limit,enforced.power.limit --format=csv,noheader

$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = 'C:\AI\miners\lolminer\lolMiner.exe --algo ETCHASH --pool etchash.unmineable.com:3333 --user leafdriving2.unmineable_miner_xpsw --pass x --apiport 60151 --nocolor' }
'  miner pid ' + $r.ProcessId

Section '3. four minutes, sampled — does it hold this time?'
for ($i = 1; $i -le 12; $i++) {
  Start-Sleep -Seconds 20
  $g = ((& $smi --query-gpu=clocks.sm,clocks.mem,power.draw,temperature.gpu,pstate --format=csv,noheader) -join '') -replace '\s+',' '
  $rate = 'api?'
  try { $rate = '{0:N2} Mh/s' -f (@(Invoke-RestMethod 'http://127.0.0.1:60151/' -TimeoutSec 5).Algorithms[0].Total_Performance) } catch { }
  '  t{0,3}s  {1}  {2}' -f ($i*20), $g, $rate
}
Section '4. verdict inputs'
& $smi --query-gpu=clocks.sm,clocks.mem,power.draw,pstate --format=csv,noheader
& $smi -q -d PERFORMANCE 2>&1 | Select-String -Pattern 'Idle|HW Slowdown|HW Thermal|Power Brake|Performance State' | Select-Object -First 6 | ForEach-Object { '  ' + $_.Line.Trim() }
'XPSW PLCAP TEST DONE'
