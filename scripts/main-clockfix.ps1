# The clock is 2 years 7 months behind (2024-04-01) because w32time is stopped. Every TLS handshake, log line and pool
# API call on this box is wrong-dated until it is fixed. Sync it, then prove the offset is gone.
$ErrorActionPreference = 'Continue'
'== before'
'  now: ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '   w32time: ' + (Get-Service w32time).Status + ' / ' + (Get-Service w32time).StartType
Set-Service w32time -StartupType Automatic -ErrorAction SilentlyContinue
Start-Service w32time -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
'== resync'
& w32tm.exe /resync /force 2>&1 | ForEach-Object { '  ' + $_.Trim() }
Start-Sleep -Seconds 3
'== after'
'  now: ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '   w32time: ' + (Get-Service w32time).Status + ' / ' + (Get-Service w32time).StartType
$st = & w32tm.exe /query /status 2>&1
($st | Select-String -Pattern 'Source|Last Successful|Poll' ) | ForEach-Object { '  ' + $_.Line.Trim() }
'CLOCKFIX DONE'
