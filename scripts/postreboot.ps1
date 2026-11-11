$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section 'pagefile took effect?'
'  commit limit {0:N0} MB' -f ((Get-CimInstance Win32_OperatingSystem).TotalVirtualMemorySize / 1024)
'  free physical {0:N0} MB' -f ((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1KB)
Get-CimInstance Win32_PageFileUsage -ErrorAction SilentlyContinue | ForEach-Object { '  {0}  allocated {1} MB  peak {2} MB' -f $_.Name, $_.AllocatedBaseSize, $_.PeakUsage }
& query session 2>&1 | ForEach-Object { '  ' + $_ }
Section 'is the supervisor up by itself'
'  task: ' + (Get-ScheduledTask -TaskName 'HydraMine1' -ErrorAction SilentlyContinue).State
Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)srb|mine-overnight' } | ForEach-Object { '  pid {0} session {1} {2}' -f $_.ProcessId, $_.SessionId, $_.Name }
Section 'gpu inventory'
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=index,name,utilization.gpu --format=csv,noheader
'  AMD: ' + (Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'PCI\VEN_1002&DEV_67DF*' }).Status
'POSTREBOOT DONE'
