# My own fault: the purge deleted C:\Users\User\AppData\Local\Temp (10 GB) while SRBMiner was running, and the miner
# died on it - all four GPUs dropped to 0.00 H/s and it logged "Internal error: 0x2004" at 09:28:15. The kernel caches
# miners keep in TEMP are exactly what went. Clean restart rebuilds them.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section 'stop everything cleanly'
Stop-ScheduledTask -TaskName 'HydraMine1' -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'mine-overnight' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 6
'  stopped'

Section 'restart under the task'
Remove-Item 'C:\AI\logs\miner-auto.txt' -Force -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName 'HydraMine1'
for ($i = 1; $i -le 8; $i++) {
  Start-Sleep -Seconds 30
  $r = 'api down'
  try { $a = Invoke-RestMethod 'http://127.0.0.1:60220/' -TimeoutSec 8; $alg = @($a.algorithms)[0]; $r = '{0:N0} H/s  A{1} R{2}' -f $alg.hashrate.'15min', $alg.shares.accepted, $alg.shares.rejected } catch { }
  $g = @(Get-Content 'C:\AI\logs\miner-auto.txt' -ErrorAction SilentlyContinue | Where-Object { $_ -match 'GPU\d.*H/s' } | Select-Object -Last 1)
  '  t{0,4}s  {1,-28} {2}' -f ($i * 30), $r, $(if ($g.Count) { ($g[0] -replace '\s+', ' ').Trim() } else { '' })
}
Section 'per-GPU'
Get-Content 'C:\AI\logs\miner-auto.txt' -ErrorAction SilentlyContinue | Where-Object { $_ -match 'GPU\d' } | Select-Object -Last 6 | ForEach-Object { '  ' + ($_ -replace '\s+', ' ').Trim() }
Section 'errors'
Get-Content 'C:\AI\logs\miner-auto.txt' -ErrorAction SilentlyContinue | Where-Object { $_ -match '(?i)error|fail|unsupported' } | Select-Object -Last 5 | ForEach-Object { '  ' + ($_ -replace '\s+', ' ').Trim() }
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=index,utilization.gpu,power.draw --format=csv,noheader
'RESTART DONE'
