$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section 'why is nothing mining'
'  task: ' + (Get-ScheduledTask -TaskName 'HydraMine1' -ErrorAction SilentlyContinue).State
Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)srb|lol|powershell' -and $_.SessionId -eq 1 } | ForEach-Object { '  pid {0} {1} :: {2}' -f $_.ProcessId, $_.Name, (($_.CommandLine -replace '\s+', ' ').Substring(0, [Math]::Min(90, ($_.CommandLine -replace '\s+',' ').Length))) }
if (Test-Path 'C:\AI\logs\supervisor.txt') { Get-Content 'C:\AI\logs\supervisor.txt' -Encoding UTF8 | Select-Object -Last 5 | ForEach-Object { '  ' + $_ } }
Section 'srbminer device-selection flags'
(& 'C:\AI\miners\srb380\SRBMiner-MULTI.exe' --help 2>&1 | Select-String -Pattern '(?i)gpu-id|gpu-ids|disable-gpu|--algorithm|platform' | Select-Object -First 12) | ForEach-Object { '  ' + ($_ -replace "`0", '').Trim() }
'CHECK DONE'
