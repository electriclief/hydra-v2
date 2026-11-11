$ErrorActionPreference = 'Continue'
'== cpu / board'
Get-CimInstance Win32_Processor | ForEach-Object { '  {0}  {1} cores / {2} threads  {3} W tdp-class' -f $_.Name.Trim(), $_.NumberOfCores, $_.NumberOfLogicalProcessors, '' }
Get-CimInstance Win32_BaseBoard | ForEach-Object { '  board: {0} {1}' -f $_.Manufacturer, $_.Product }
'== gpu power envelope'
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=name,power.draw,power.limit,power.default_limit,power.min_limit,power.max_limit,enforced.power.limit --format=csv
'== what is it doing'
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=utilization.gpu,memory.used,temperature.gpu,clocks.sm --format=csv,noheader
'== cpu load now'
'  cpu %: ' + [math]::Round((Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor | Where-Object Name -eq '_Total').PercentProcessorTime, 0)
'== drives'
Get-PhysicalDisk | ForEach-Object { '  {0} {1} {2}' -f $_.FriendlyName, $_.MediaType, [math]::Round($_.Size / 1GB) }
'PSU-PROBE DONE'
