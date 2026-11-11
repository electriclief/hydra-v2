# Read back the autologon settings without printing the password.
$k = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
'AutoAdminLogon  = {0}' -f $k.AutoAdminLogon
'ForceAutoLogon  = {0}' -f $k.ForceAutoLogon
'DefaultUserName = {0}' -f $k.DefaultUserName
'DefaultDomain   = {0}' -f $k.DefaultDomainName
'DefaultPassword = {0}' -f $(if ($k.DefaultPassword) { 'set (not shown)' } else { 'ABSENT' })
$pol = Get-ItemProperty 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Personalization' -ErrorAction SilentlyContinue
'NoLockScreen    = {0}' -f $pol.NoLockScreen
'hostname        = {0}' -f $env:COMPUTERNAME
'account         = {0}' -f (whoami)
