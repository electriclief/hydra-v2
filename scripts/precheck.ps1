$ErrorActionPreference = 'Continue'
'=== console sessions (is anyone logged in where a window could show?)'
& query session 2>&1 | ForEach-Object { '  ' + $_ }
'=== who is logged on'
& quser 2>&1 | ForEach-Object { '  ' + $_ }
'=== auto-logon configured?'
$w = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
$p = Get-ItemProperty $w -ErrorAction SilentlyContinue
'  AutoAdminLogon = ' + $p.AutoAdminLogon
'  DefaultUserName = ' + $p.DefaultUserName
'  DefaultPassword set = ' + [bool]$p.DefaultPassword
'=== TdrDelay'
$g = Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers' -ErrorAction SilentlyContinue
'  TdrDelay = ' + $g.TdrDelay
'  TdrLevel = ' + $g.TdrLevel
'=== Defender exclusions for the miner/tool roots'
$pref = Get-MpPreference -ErrorAction SilentlyContinue
'  paths: ' + (($pref.ExclusionPath) -join ' | ')
'  processes: ' + (($pref.ExclusionProcess) -join ' | ')
'=== existing tasks that look like mining'
Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -match '(?i)mine|hydra' } | ForEach-Object { '  {0}  [{1}]' -f $_.TaskName, $_.State }
'PRECHECK DONE'
