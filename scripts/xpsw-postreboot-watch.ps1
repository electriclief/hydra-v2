# One more reboot, then watch the card from the first seconds: if it clocks up and then falls back, a protection
# (fan tach / power brake) is engaging during the run; if it never leaves idle clocks, the cap is there from boot and
# the boot chain is innocent.
$ErrorActionPreference = 'Continue'
$smi = 'C:\Windows\System32\nvidia-smi.exe'
'== watch started ' + (Get-Date -Format 'HH:mm:ss')
for ($i = 1; $i -le 14; $i++) {
  $g = ((& $smi --query-gpu=clocks.sm,clocks.mem,power.draw,temperature.gpu,fan.speed,utilization.gpu,pstate --format=csv,noheader) -join '') -replace '\s+',' '
  $rate = 'api?'
  try { $rate = '{0:N2} Mh/s' -f (@(Invoke-RestMethod 'http://127.0.0.1:60151/' -TimeoutSec 5).Algorithms[0].Total_Performance) } catch { }
  '  t{0,3}s  {1}  {2}' -f ($i*20), $g, $rate
  Start-Sleep -Seconds 20
}
'  miner processes: ' + @(Get-Process lolMiner -ErrorAction SilentlyContinue).Count
'== fan detail'
& $smi -q -d FAN 2>&1 | Select-String -Pattern 'Fan Speed|Fan Target|Fan Min|Fan Max' | ForEach-Object { '  ' + $_.Line.Trim() }
'== throttle reasons'
& $smi -q -d PERFORMANCE 2>&1 | Select-String -Pattern 'Performance State|Clocks Event Reasons|Idle|Applications Clocks|Slowdown' | Select-Object -First 12 | ForEach-Object { '  ' + $_.Line.Trim() }
'XPSW POSTREBOOT WATCH DONE'
