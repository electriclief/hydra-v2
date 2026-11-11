# Write the fleet autologon value on THIS node from a base64 file, then delete the file. Prints only whether it is set.
$ErrorActionPreference = 'Continue'
$src = 'C:\Users\User\pw.b64'
if (-not (Test-Path $src)) { '  pw.b64 not present - nothing to import'; 'PWIMPORT DONE'; exit 1 }
$b64 = (Get-Content $src -Raw).Trim()
$pw = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
$wl = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
$me = $env:USERNAME
Set-ItemProperty $wl -Name AutoAdminLogon  -Value '1' -Type String
Set-ItemProperty $wl -Name ForceAutoLogon  -Value '1' -Type String
Set-ItemProperty $wl -Name DefaultUserName -Value $me  -Type String
Set-ItemProperty $wl -Name DefaultDomainName -Value $env:COMPUTERNAME -Type String
Set-ItemProperty $wl -Name DefaultPassword -Value $pw  -Type String
New-Item -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Personalization' -Force | Out-Null
New-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Personalization' -Name NoLockScreen -PropertyType DWord -Value 1 -Force | Out-Null
Remove-Item $src -Force
'  password set (not shown, {0} chars)' -f $pw.Length
'  --- readback'
$r = Get-ItemProperty $wl
'  AutoAdminLogon {0}   ForceAutoLogon {1}   user {2}   domain {3}' -f $r.AutoAdminLogon, $r.ForceAutoLogon, $r.DefaultUserName, $r.DefaultDomainName
'  DefaultPassword present: {0}' -f [bool]$r.DefaultPassword
'  NoLockScreen: {0}' -f (Get-ItemProperty 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Personalization' -Name NoLockScreen -ErrorAction SilentlyContinue).NoLockScreen
'  staging file deleted: {0}' -f (-not (Test-Path $src))
'PWIMPORT DONE'
