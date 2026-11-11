$ErrorActionPreference = 'Continue'
$sc = 'C:\Hydra\reliability\smartmontools\bin\smartctl.exe'
'  uptime min : ' + [math]::Round(((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalMinutes, 1)
'  system time: ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
'  --- short self-test result'
& $sc -l selftest -d sat /dev/sda 2>&1 | Select-String -Pattern 'Num|# 1|SMART Self-test|completed|error' | Select-Object -First 6 | ForEach-Object { '    ' + $_.Line.Trim() }
'  --- health again'
& $sc -H -d sat /dev/sda 2>&1 | Select-String -Pattern 'result' | ForEach-Object { '    ' + $_.Line.Trim() }
'  --- cpu load and temps'
Get-CimInstance Win32_Processor | ForEach-Object { '    load {0}%  clock {1} MHz' -f $_.LoadPercentage, $_.CurrentClockSpeed }
Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | ForEach-Object { '    thermal zone {0}: {1:N1} C' -f $_.InstanceName, (($_.CurrentTemperature / 10) - 273.15) }
'  --- newest power events'
Get-WinEvent -FilterHashtable @{LogName='System'; Id=41,6008} -MaxEvents 3 -ErrorAction SilentlyContinue | ForEach-Object { '    {0:yyyy-MM-dd HH:mm} id {1}' -f $_.TimeCreated, $_.Id }
'ST DONE'
