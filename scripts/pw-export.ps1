# Export the fleet autologon value as base64 so it can cross to another node without ever appearing in output.
$ErrorActionPreference = 'Stop'
$wl = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
$pw = (Get-ItemProperty $wl).DefaultPassword
if (-not $pw) { 'no DefaultPassword on this box'; 'PWEXPORT DONE'; exit 1 }
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pw))
[System.IO.File]::WriteAllText('C:\Users\User\pw.b64', $b64, (New-Object System.Text.UTF8Encoding($false)))
'  wrote C:\Users\User\pw.b64  (' + $b64.Length + ' base64 chars, value never printed)'
'  source user: ' + (Get-ItemProperty $wl).DefaultUserName
'PWEXPORT DONE'
