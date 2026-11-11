$ErrorActionPreference = 'Continue'
'  system time now : ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
'  UTC             : ' + (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd HH:mm:ss')
'  last boot       : ' + (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
'  uptime minutes  : ' + [math]::Round(((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalMinutes, 1)
'  timezone        : ' + (Get-TimeZone).Id
'  w32time service : ' + (Get-Service w32time -ErrorAction SilentlyContinue).Status
'  w32time source  : ' + ((w32tm /query /status 2>&1) -join ' | ').Substring(0, [Math]::Min(220, ((w32tm /query /status 2>&1) -join ' | ').Length))
'  os install date : ' + (Get-CimInstance Win32_OperatingSystem).InstallDate
'CLOCK DONE'
