$ErrorActionPreference = 'Continue'
$p = 'C:\AI\tools\mine-overnight.ps1'
if (-not (Test-Path $p)) { 'MISSING ' + $p; exit }
$c = Get-Content $p -Raw
'  file    : {0}  {1:N0} B  {2}' -f $p, (Get-Item $p).Length, (Get-Item $p).LastWriteTime
'  Stop-MinerHard : {0}' -f [bool]($c -match 'function Stop-MinerHard')
'  STUCK guard    : {0}' -f [bool]($c -match 'STUCK:')
'  task state     : {0}' -f (Get-ScheduledTask -TaskName 'HydraMine1' -ErrorAction SilentlyContinue).State
'  miners/sups    : {0} / {1}' -f @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)srbminer|lolminer' }).Count, @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'mine-overnight' }).Count
'VERIFY DONE'
