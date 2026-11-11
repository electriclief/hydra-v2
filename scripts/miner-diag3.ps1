$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section 'task and processes'
'  task HydraMine1: ' + (Get-ScheduledTask -TaskName 'HydraMine1' -ErrorAction SilentlyContinue).State
'  last result: ' + (Get-ScheduledTaskInfo -TaskName 'HydraMine1' -ErrorAction SilentlyContinue).LastTaskResult
Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)srb|powershell' -and ($_.CommandLine -match 'srb|mine-overnight') } | ForEach-Object { '  pid {0} session {1} {2}' -f $_.ProcessId, $_.SessionId, (($_.CommandLine -replace '\s+',' ').Substring(0,[Math]::Min(110,($_.CommandLine -replace '\s+',' ').Length))) }
Section 'supervisor log'
Get-Content 'C:\AI\logs\supervisor.txt' -Encoding UTF8 -ErrorAction SilentlyContinue | Select-Object -Last 10 | ForEach-Object { '  ' + $_ }
Section 'miner log'
$l = Get-Content 'C:\AI\logs\miner-auto.txt' -ErrorAction SilentlyContinue
if ($l) { '  lines: ' + @($l).Count; @($l) | Select-Object -Last 14 | ForEach-Object { '  ' + ($_ -replace '\s+',' ').Trim() } } else { '  miner-auto.txt is EMPTY or missing' }
Section 'can SRBMiner initialise now'
$d = & 'C:\AI\miners\srb380\SRBMiner-MULTI.exe' --list-devices 2>&1
$d | Where-Object { $_ -match '(?i)opencl|cuda|GPU\d|platform|cannot|error|failed' } | Select-Object -First 8 | ForEach-Object { '  ' + ($_ -replace "`0",'').Trim() }
Section 'temp folders'
foreach ($p in 'C:\Users\User\AppData\Local\Temp', 'C:\Windows\Temp') { '  {0,-42} {1}' -f $p, $(if (Test-Path $p) { 'exists' } else { 'MISSING' }) }
Section 'space and commit'
'  C: free {0:N1} GB   commit limit {1:N0} MB   free physical {2:N0} MB' -f ((Get-Volume -DriveLetter C).SizeRemaining / 1GB), ((Get-CimInstance Win32_OperatingSystem).TotalVirtualMemorySize / 1024), ((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1KB)
Section 'processwrapper rows'
try { $pws = Invoke-RestMethod 'http://127.0.0.1:8125/api/processes' -TimeoutSec 10; @($pws.processes) | Where-Object { $_.name -match 'miner|srb' } | ForEach-Object { '  {0,-24} {1,-9} pid {2}' -f $_.name, $_.life, $_.pid } } catch { '  pw api: ' + $_.Exception.Message }
'DIAG3 DONE'
