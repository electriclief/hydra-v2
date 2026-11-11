$ErrorActionPreference = 'Continue'
'== api 60220'
try { $a = Invoke-RestMethod 'http://127.0.0.1:60220/' -TimeoutSec 10; $alg = @($a.algorithms)[0]; '  {0:N0} H/s   A{1} R{2}' -f $alg.hashrate.'15min', $alg.shares.accepted, $alg.shares.rejected } catch { '  api: ' + $_.Exception.Message }
'== per-GPU lines (last 6)'
Get-Content 'C:\AI\logs\miner-auto.txt' -ErrorAction SilentlyContinue | Where-Object { $_ -match 'GPU\d.*H/s|GPU\d:' } | Select-Object -Last 6 | ForEach-Object { '  ' + ($_ -replace '\s+', ' ').Trim() }
'== shares per GPU (last 6)'
Get-Content 'C:\AI\logs\miner-auto.txt' -ErrorAction SilentlyContinue | Where-Object { $_ -match 'share accepted|SHARE REJECTED' } | Select-Object -Last 6 | ForEach-Object { '  ' + ($_ -replace '\s+', ' ').Trim() }
'== errors (last 5)'
Get-Content 'C:\AI\logs\miner-auto.txt' -ErrorAction SilentlyContinue | Where-Object { $_ -match '(?i)out of memory|error|failed|not supported' } | Select-Object -Last 5 | ForEach-Object { '  ' + ($_ -replace '\s+', ' ').Trim() }
'== hardware'
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=index,name,utilization.gpu,memory.used,power.draw --format=csv,noheader
'  AMD: ' + (Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'PCI\VEN_1002&DEV_67DF*' }).Status
'  commit limit {0:N0} MB' -f ((Get-CimInstance Win32_OperatingSystem).TotalVirtualMemorySize / 1024)
'== supervisor trail'
Get-Content 'C:\AI\logs\supervisor.txt' -Encoding UTF8 -ErrorAction SilentlyContinue | Select-Object -Last 4 | ForEach-Object { '  ' + $_ }
'STATUS DONE'
