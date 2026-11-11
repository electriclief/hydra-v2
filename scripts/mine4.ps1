# Four cards, one instance, under the supervisor. The pagefile now gives a 12,172 MB commit limit (was 5,388),
# so the OpenCL context and three CUDA contexts have room. This measures each card's own rate and the share count.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }

Section 'one clean start under the supervisor'
Stop-ScheduledTask -TaskName 'HydraMine1' -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'mine-overnight' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 5
Remove-Item 'C:\AI\logs\miner-auto.txt' -Force -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName 'HydraMine1'
'  started'

Section 'watch for 5 minutes'
for ($i = 1; $i -le 7; $i++) {
  Start-Sleep -Seconds 45
  $rate = 'n/a'
  try { $a = Invoke-RestMethod 'http://127.0.0.1:60220/' -TimeoutSec 8; $alg = @($a.algorithms)[0]; $rate = '{0:N0} H/s A{1} R{2}' -f $alg.hashrate.'15min', $alg.shares.accepted, $alg.shares.rejected } catch { $rate = 'api down' }
  $gpu = @(Get-Content 'C:\AI\logs\miner-auto.txt' -ErrorAction SilentlyContinue | Where-Object { $_ -match 'GPU\d.*H/s' } | Select-Object -Last 1)
  '  t{0,4}s  {1,-34} {2}' -f ($i * 45), $rate, $(if ($gpu.Count) { ($gpu[0] -replace '\s+', ' ').Trim() } else { '' })
}

Section 'per-GPU rates from the miner log'
$l = Get-Content 'C:\AI\logs\miner-auto.txt' -ErrorAction SilentlyContinue
$l | Where-Object { $_ -match 'GPU\d' } | Select-Object -Last 8 | ForEach-Object { '  ' + ($_ -replace '\s+', ' ').Trim() }
Section 'accumulated shares per GPU'
$l | Where-Object { $_ -match 'share accepted|SHARE REJECTED' } | Select-Object -Last 8 | ForEach-Object { '  ' + ($_ -replace '\s+', ' ').Trim() }
Section 'errors'
$l | Where-Object { $_ -match '(?i)out of memory|error|failed|recovery' } | Select-Object -Last 6 | ForEach-Object { '  ' + ($_ -replace '\s+', ' ').Trim() }
Section 'hardware'
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=index,name,utilization.gpu,memory.used,power.draw --format=csv,noheader
'  AMD status: ' + (Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'PCI\VEN_1002&DEV_67DF*' }).Status
'  commit limit {0:N0} MB  free {1:N0} MB' -f ((Get-CimInstance Win32_OperatingSystem).TotalVirtualMemorySize / 1024), ((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1KB)
'MINE4 DONE'
