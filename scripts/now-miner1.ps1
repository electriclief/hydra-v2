$ErrorActionPreference = 'Continue'
'  uptime min : ' + [math]::Round(((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalMinutes, 1)
'  task       : ' + (Get-ScheduledTask -TaskName 'HydraMine1' -ErrorAction SilentlyContinue).State
'  miners     : ' + @(Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue).Count
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | ForEach-Object { '    pid {0} started {1:HH:mm:ss}' -f $_.Id, $_.StartTime }
'  supervisors: ' + @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'mine-overnight' }).Count
'  miner log lines: ' + @(Get-Content 'C:\AI\logs\miner-auto.txt' -ErrorAction SilentlyContinue).Count
'  --- supervisor trail'
Get-Content 'C:\AI\logs\supervisor.txt' -Encoding UTF8 -ErrorAction SilentlyContinue | Select-Object -Last 8 | ForEach-Object { '    ' + $_ }
'  --- miner log head'
Get-Content 'C:\AI\logs\miner-auto.txt' -ErrorAction SilentlyContinue | Select-Object -First 6 | ForEach-Object { '    ' + ($_ -replace '\s+',' ').Trim() }
'  --- api'
try { $a = Invoke-RestMethod 'http://127.0.0.1:60220/' -TimeoutSec 8; $alg = @($a.algorithms)[0]; '    {0:N0} H/s A{1} R{2}' -f $alg.hashrate.'15min', $alg.shares.accepted, $alg.shares.rejected } catch { '    down: ' + $_.Exception.Message }
'NOW DONE'
