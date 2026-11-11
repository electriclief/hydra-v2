# XPSW: passwordless boot + the visible window. Same chain proved on jims laptop.
# The shelf is already running from a detached raise (session 0), so the window is invisible until the box
# logs itself in and the Startup shortcut raises it in session 1.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }

Section '1. autologon from the carried value'
$src = 'C:\Users\User\pw.b64'
if (Test-Path $src) {
  $pw = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(((Get-Content $src -Raw).Trim())))
  $wl = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
  Set-ItemProperty $wl -Name AutoAdminLogon   -Value '1' -Type String
  Set-ItemProperty $wl -Name ForceAutoLogon   -Value '1' -Type String
  Set-ItemProperty $wl -Name DefaultUserName  -Value $env:USERNAME -Type String
  Set-ItemProperty $wl -Name DefaultDomainName -Value $env:COMPUTERNAME -Type String
  Set-ItemProperty $wl -Name DefaultPassword  -Value $pw -Type String
  New-Item -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Personalization' -Force | Out-Null
  New-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Personalization' -Name NoLockScreen -PropertyType DWord -Value 1 -Force | Out-Null
  Remove-Item $src -Force
  '  password set (not shown, {0} chars)' -f $pw.Length
} else { '  no pw.b64 to import' }
$r = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
'  AutoAdminLogon={0} ForceAutoLogon={1} user={2} domain={3} password set={4}' -f $r.AutoAdminLogon, $r.ForceAutoLogon, $r.DefaultUserName, $r.DefaultDomainName, [bool]$r.DefaultPassword

Section '2. Startup shortcut -> the launcher that raises the window'
$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'Hydra V2.lnk'
$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut($lnk)
$s.TargetPath = 'C:\AI\hydra-local\scripts\relaunch-xpsw.cmd'
$s.WorkingDirectory = 'C:\AI\hydra-local'
$s.Description = 'Hydra V2 on XPSW - raises the shelf and opens the window'
$s.Save()
'  ' + $lnk + '  exists=' + (Test-Path $lnk)
Get-ChildItem $startup | ForEach-Object { '    startup: ' + $_.Name }

Section '3. no sleep, screen off after 30 min, lid/standby never'
& powercfg /h off 2>&1 | Out-Null
& powercfg /change monitor-timeout-ac 30
& powercfg /change standby-timeout-ac 0
& powercfg /change disk-timeout-ac 0
& powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP STANDBYIDLE 0
& powercfg /setactive SCHEME_CURRENT
Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -Name HiberbootEnabled -Value 0 -Type DWord
'  HiberbootEnabled=' + (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power').HiberbootEnabled

Section '4. the miner that is running now, read properly'
$raw = $null
try { $raw = Invoke-RestMethod 'http://127.0.0.1:60151/' -TimeoutSec 6 } catch { }
if ($raw) {
  $w = @($raw.Workers)[0]
  '  worker fields: ' + (($w.PSObject.Properties | Select-Object -ExpandProperty Name) -join ', ')
  '  speed        : ' + (($w.Speed.PSObject.Properties | ForEach-Object { $_.Name + '=' + $_.Value }) -join '  ')
  '  shares       : ' + (($w.Shares.PSObject.Properties | ForEach-Object { $_.Name + '=' + $_.Value }) -join '  ')
  '  algo         : ' + $w.Selected_Algorithm + '   pool: ' + $raw.Session.Pool
} else { '  api not answering' }
'  pw table row: ' + ((Invoke-RestMethod 'http://127.0.0.1:8125/api/processes' -TimeoutSec 6).processes | Where-Object { $_.name -eq 'standby-miner' } | Select-Object -First 1 -ExpandProperty id)
'XPSW WIRE DONE'
