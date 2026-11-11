# Turn on passwordless autologon for this box, using a password file that is deleted immediately.
# Prints only what was set - never the value.
$ErrorActionPreference = 'Stop'
$src = 'C:\Users\User\pw.tmp'
if (-not (Test-Path $src)) { 'NO_PASSWORD_FILE - nothing changed'; exit 1 }
$pw = [System.IO.File]::ReadAllText($src).Trim()
if (-not $pw) { Remove-Item $src -Force; 'EMPTY_PASSWORD_FILE - nothing changed'; exit 1 }

$key = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
$before = Get-ItemProperty -Path $key
'before: AutoAdminLogon={0} user={1} password={2}' -f $before.AutoAdminLogon, $before.DefaultUserName, $(if ($before.DefaultPassword) { 'set' } else { 'absent' })

Set-ItemProperty -Path $key -Name AutoAdminLogon    -Value '1'            -Type String
Set-ItemProperty -Path $key -Name ForceAutoLogon    -Value '1'            -Type String
Set-ItemProperty -Path $key -Name DefaultUserName   -Value 'User'         -Type String
Set-ItemProperty -Path $key -Name DefaultDomainName -Value $env:COMPUTERNAME -Type String
Set-ItemProperty -Path $key -Name DefaultPassword   -Value $pw            -Type String

# no lock screen on wake, and no "choose an account" screen after a sign-out
$pol = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Personalization'
if (-not (Test-Path $pol)) { New-Item -Path $pol -Force | Out-Null }
Set-ItemProperty -Path $pol -Name NoLockScreen -Value 1 -Type DWord

# a sleeping headless node that nobody wakes is a node that stopped answering; keep the screen on
powercfg /change standby-timeout-ac 0        2>$null
powercfg /change monitor-timeout-ac 0        2>$null
powercfg /change hibernate-timeout-ac 0      2>$null
powercfg /hibernate off                      2>$null

Remove-Item $src -Force

$after = Get-ItemProperty -Path $key
'after:  AutoAdminLogon={0} ForceAutoLogon={1} user={2} domain={3} password={4}' -f `
  $after.AutoAdminLogon, $after.ForceAutoLogon, $after.DefaultUserName, $after.DefaultDomainName,
  $(if ($after.DefaultPassword) { 'set (not shown)' } else { 'MISSING' })
'NoLockScreen=' + (Get-ItemProperty -Path $pol -Name NoLockScreen).NoLockScreen
'password file removed: ' + (-not (Test-Path $src))
