# Why gtx-1660 boots to no session: AutoAdminLogon=1 is set but there is no interactive logon (type 2) in the Security log
# and no explorer.exe — so no Startup folder runs and nothing user-level starts. Two causes are worth separating:
#   (a) the stored password does not match the account -> LogonUser fails with 1326
#   (b) Windows 11's passwordless sign-in experience ignores DefaultPassword -> DevicePasswordLessBuildVersion
# This script tests (a) without ever printing the value, then fixes (b), then prints the state.
$ErrorActionPreference = 'Continue'
$wl = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
$w = Get-ItemProperty $wl

'host: ' + $env:COMPUTERNAME
'  user=' + $w.DefaultUserName + '  domain=' + $w.DefaultDomain + '  pwlen=' + ([string]$w.DefaultPassword).Length

'--- (a) does the stored password actually authenticate?'
$sig = @'
using System;
using System.Runtime.InteropServices;
public class Cred {
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool LogonUser(string u, string d, string p, int type, int provider, out IntPtr token);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
}
'@
try {
  Add-Type -TypeDefinition $sig -ErrorAction Stop
  $tok = [IntPtr]::Zero
  $ok = [Cred]::LogonUser($w.DefaultUserName, $env:COMPUTERNAME, $w.DefaultPassword, 2, 0, [ref]$tok)
  if ($ok) {
    [Cred]::CloseHandle($tok) | Out-Null
    '  the stored password WORKS for an interactive logon'
  } else {
    '  LogonUser FAILED, win32 error ' + [Runtime.InteropServices.Marshal]::GetLastWin32Error() + ' (1326 = wrong user name or password)'
  }
} catch { '  LogonUser test unavailable: ' + $_.Exception.Message }

'--- (b) is the passwordless sign-in experience in the way?'
$plKey = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\PasswordLess\Device'
if (Test-Path $plKey) {
  '  DevicePasswordLessBuildVersion = ' + (Get-ItemProperty $plKey).DevicePasswordLessBuildVersion
  Set-ItemProperty $plKey -Name 'DevicePasswordLessBuildVersion' -Value 0 -Type DWord -Force
  '  set to 0 (classic sign-in, so DefaultPassword is honoured)'
} else {
  '  no PasswordLess key on this build'
}

'--- make the autologon entry complete'
Set-ItemProperty $wl -Name 'AutoAdminLogon' -Value '1' -Force
Set-ItemProperty $wl -Name 'ForceAutoLogon' -Value '1' -Force
if (-not $w.DefaultDomain) { Set-ItemProperty $wl -Name 'DefaultDomain' -Value $env:COMPUTERNAME -Force; '  DefaultDomain was empty -> ' + $env:COMPUTERNAME }

'--- is autologon blocked by policy?'
$pol = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'
foreach ($n in 'DisableAutomaticRestartSignOn', 'DisableCAD') { if ((Get-ItemProperty $pol -ErrorAction SilentlyContinue).$n) { '  policy ' + $n + ' = ' + (Get-ItemProperty $pol).$n } }
'    (DisableAutomaticRestartSignOn=1 does not block a cold boot autologon)'

'after:'
$w2 = Get-ItemProperty $wl
'  AutoAdminLogon=' + $w2.AutoAdminLogon + ' ForceAutoLogon=' + $w2.ForceAutoLogon + ' user=' + $w2.DefaultUserName + ' domain=' + $w2.DefaultDomain + ' pwset=' + [bool]$w2.DefaultPassword
'AUTOLOGON CHECK DONE'
