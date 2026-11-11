# Export the fleet password from a node that already has autologon configured.
# It is written to a file and never printed: the value is a fleet convention, not something to
# scatter through logs, and the only reason this exists is to carry it to another box.
$ErrorActionPreference = 'Stop'
$key = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
$v = (Get-ItemProperty -Path $key -Name DefaultPassword -ErrorAction SilentlyContinue).DefaultPassword
if (-not $v) { 'NO_PASSWORD_STORED'; exit 1 }
[System.IO.File]::WriteAllText('C:\AI\reports\pw.tmp', $v, (New-Object System.Text.ASCIIEncoding))
'exported to C:\AI\reports\pw.tmp (value not shown)'
