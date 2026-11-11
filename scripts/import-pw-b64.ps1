# Arm passwordless autologon on this box from a base64 file, so the value never passes through a shell, a log or a report.
# Writes: AutoAdminLogon, ForceAutoLogon, DefaultUserName, DefaultDomainName, DefaultPassword; no lock screen; no sleep.
# Prints only what was set. Deletes both the b64 and the decoded file at the end.
$ErrorActionPreference = 'Stop'
$b64f = 'C:\Users\User\pw.b64'
if (-not (Test-Path $b64f)) { 'NO_B64_FILE - nothing changed'; exit 1 }
$b64 = ([System.IO.File]::ReadAllText($b64f)).Trim()
if (-not $b64) { Remove-Item $b64f -Force; 'EMPTY_B64 - nothing changed'; exit 1 }
$pw = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
if (-not $pw) { Remove-Item $b64f -Force; 'EMPTY_PASSWORD - nothing changed'; exit 1 }

$key = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
$before = Get-ItemProperty -Path $key
'before      : AutoAdminLogon={0} user={1} password={2}' -f $before.AutoAdminLogon, $before.DefaultUserName,
  $(if ($before.DefaultPassword) { 'stored' } else { 'absent' })

Set-ItemProperty -Path $key -Name AutoAdminLogon    -Value '1'               -Type String
Set-ItemProperty -Path $key -Name ForceAutoLogon    -Value '1'               -Type String
Set-ItemProperty -Path $key -Name DefaultUserName   -Value 'User'            -Type String
Set-ItemProperty -Path $key -Name DefaultDomainName -Value $env:COMPUTERNAME -Type String
Set-ItemProperty -Path $key -Name DefaultPassword   -Value $pw               -Type String

# The account must not be flagged for a password change, or Windows shows a prompt instead of the desktop.
try {
  $u = Get-CimInstance Win32_UserAccount -Filter ("Name='User' AND Domain='" + $env:COMPUTERNAME + "'") -ErrorAction Stop
  $acct = Get-LocalUser -Name $u.Name -ErrorAction SilentlyContinue
  'account     : {0}  enabled={1}  passwordRequired={2}  passwordExpires={3}' -f $acct.Name, $acct.Enabled,
    $acct.PasswordRequired, $acct.PasswordExpires
  if ($acct -and $acct.PasswordRequired) { net accounts /passwordreq:no | Out-Null; 'account     : password requirement cleared' }
} catch { 'account     : could not read ' + $_.Exception.Message }

$pol = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Personalization'
if (-not (Test-Path $pol)) { New-Item -Path $pol -Force | Out-Null }
Set-ItemProperty -Path $pol -Name NoLockScreen -Value 1 -Type DWord

# A headless rig that sleeps is a rig that stopped answering.
powercfg /change standby-timeout-ac 0   2>$null
powercfg /change monitor-timeout-ac 0   2>$null
powercfg /change hibernate-timeout-ac 0 2>$null
powercfg /hibernate off                 2>$null
'power       : standby/monitor/hibernate off, hibernate disabled'

Remove-Item $b64f -Force -ErrorAction SilentlyContinue
$after = Get-ItemProperty -Path $key
'after       : AutoAdminLogon={0} ForceAutoLogon={1} user={2} domain={3} password={4}' -f $after.AutoAdminLogon,
  $after.ForceAutoLogon, $after.DefaultUserName, $after.DefaultDomainName,
  $(if ($after.DefaultPassword) { 'stored (not shown, ' + $after.DefaultPassword.Length + ' chars)' } else { 'MISSING' })
'NoLockScreen: ' + (Get-ItemProperty -Path $pol -Name NoLockScreen).NoLockScreen
'b64 removed : ' + (-not (Test-Path $b64f))
