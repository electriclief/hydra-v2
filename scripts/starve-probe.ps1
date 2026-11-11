$ErrorActionPreference = 'Continue'
$SMI = 'C:\Windows\System32\nvidia-smi.exe'
'== clocks / state under load'
& $SMI --query-gpu=name,pstate,clocks.sm,clocks.mem,clocks.throttle_reasons.active,utilization.gpu,utilization.memory,power.draw,temperature.gpu,pcie.link.gen.current,pcie.link.width.current --format=csv
'== full clock + perf block'
& $SMI -q -d CLOCK 2>&1 | Select-String -Pattern 'Graphics|SM |Memory|Video' | Select-Object -First 8 | ForEach-Object { '  ' + $_.Line.Trim() }
& $SMI -q -d PERFORMANCE 2>&1 | Select-String -Pattern 'Performance State|Clocks Event|Clocks Throttle' -Context 0,2 | ForEach-Object { '  ' + $_.Line.Trim() }
'== driver + vbios'
& $SMI --query-gpu=driver_version,vbios_version,memory.total,serial --format=csv
'== paging (is the DAG spilling to host?)'
& $SMI -q -d PAGING 2>&1 | Select-String -Pattern 'Paging|Retired' | ForEach-Object { '  ' + $_.Line.Trim() }
'== what lolMiner says about its kernel'
$logs = @('C:\AI\logs\lolmine.log', 'C:\AI\logs\watch.log') | Where-Object { Test-Path $_ }
foreach ($f in $logs) {
  '  --- ' + $f
  Get-Content $f -Tail 400 | Where-Object { $_ -match '(?i)kernel|memory|mhz|core|h/s|using|algo|epoch|dag' } | Select-Object -Last 12 | ForEach-Object { '    ' + ($_ -replace '\s+', ' ').Trim() }
}
'== the miner process and its command line'
Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)lolminer' } | ForEach-Object { '  ' + (($_.CommandLine -replace '\s+', ' ')) }
'STARVE-PROBE DONE'
