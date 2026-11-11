# Last-minute checks before the case is opened. Read the state that a reboot can silently take away, and set the one
# thing that must be set BEFORE the reboot to matter: TdrDelay, the guard that stops Windows resetting the driver under a
# long-running mining kernel (the classic "screen flashes, miner dies" on an unattended rig).
$ErrorActionPreference = 'Continue'
$me = [Security.Principal.WindowsIdentity]::GetCurrent()
$admin = (New-Object Security.Principal.WindowsPrincipal($me)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
'account     : {0}   administrator={1}' -f $me.Name, $admin

$s = Get-Service sshd -ErrorAction SilentlyContinue
if ($s) { 'sshd        : {0} / start {1}' -f $s.Status, $s.StartType } else { 'sshd        : MISSING' }
$f = Get-NetFirewallRule -DisplayName 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue
'fw rule 22  : ' + $(if ($f) { "$($f.Enabled)  $($f.Profile)" } else { 'MISSING' })
if ($f -and -not $f.Enabled) { Enable-NetFirewallRule -DisplayName 'OpenSSH-Server-In-TCP'; 'fw rule 22  : re-enabled' }

$keyAdmin = 'C:\ProgramData\ssh\administrators_authorized_keys'
$keyUser = Join-Path $env:USERPROFILE '.ssh\authorized_keys'
'key admin   : ' + $(if (Test-Path $keyAdmin) { "$((Get-Item $keyAdmin).Length) bytes" } else { 'MISSING' })
'key user    : ' + $(if (Test-Path $keyUser) { "$((Get-Item $keyUser).Length) bytes" } else { 'MISSING' })

$k = 'HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers'
$cur = (Get-ItemProperty $k -Name TdrDelay -ErrorAction SilentlyContinue).TdrDelay
if ($admin) {
  if ($cur -ne 60) {
    Set-ItemProperty -Path $k -Name TdrDelay -Value 60 -Type DWord
    'TdrDelay    : {0} -> 60 (takes effect at the reboot you are about to do)' -f $(if ($null -eq $cur) { 'unset' } else { $cur })
  } else { 'TdrDelay    : 60 (already)' }
} else { 'TdrDelay    : {0} - NOT SET, not admin' -f $(if ($null -eq $cur) { 'unset' } else { $cur }) }

'disk C:     : {0:N1} GB free' -f ((Get-PSDrive C).Free / 1GB)
'driver      : ' + $(if (Test-Path 'C:\AI\tools\dl\nvidia-582.66.exe') { '{0:N0} MB staged at C:\AI\tools\dl\nvidia-582.66.exe' -f ((Get-Item 'C:\AI\tools\dl\nvidia-582.66.exe').Length / 1MB) } else { 'MISSING' })
'after-card  : ' + $(if (Test-Path 'C:\AI\tools\after-card.ps1') { 'present' } else { 'MISSING' })
'mine-1650   : ' + $(if (Test-Path 'C:\AI\tools\mine-1650.cmd') { 'present' } else { 'MISSING' })
'llama       : ' + $(if (Test-Path 'C:\AI\llama\llama-server.exe') { 'llama-server.exe' } else { 'MISSING' })
'srbminer    : ' + $(if (Test-Path 'C:\AI\miners\srbminer\SRBMiner-MULTI.exe') { 'SRBMiner-MULTI.exe' } else { 'MISSING' })
'lolminer    : ' + $(if (Test-Path 'C:\AI\miners\lolminer\lolMiner.exe') { 'lolMiner.exe' } else { 'MISSING' })

'--- what a reboot must bring back by itself'
Get-Service sshd, Winmgmt, LanmanServer -ErrorAction SilentlyContinue | ForEach-Object { '  {0,-14} {1} / {2}' -f $_.Name, $_.Status, $_.StartType }
'  (sshd must read Automatic; if it reads Manual or Disabled I cannot get back in without you)'
