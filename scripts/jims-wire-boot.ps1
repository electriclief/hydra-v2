# Wire jims laptop to come back on its own: guarded mining at logon, Hydra in the Startup folder,
# no sleep and no hibernate (a laptop left alone in another room will otherwise suspend).
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }

Section '1. the guarded miner launcher'
$guard = 'C:\AI\miners\run-gpu-guarded.cmd'
if (-not (Test-Path $guard)) { '  MISSING ' + $guard; 'WIRE FAILED'; exit 1 }
'  present: ' + $guard + '  ' + (Get-Item $guard).Length + ' B'

Section '2. point hydra-mine-gpu at it, and stop the CPU task competing'
$t = Get-ScheduledTask -TaskName 'hydra-mine-gpu' -ErrorAction SilentlyContinue
if ($t) {
  $act = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/c "' + $guard + '"')
  Set-ScheduledTask -TaskName 'hydra-mine-gpu' -Action $act | Out-Null
  $t2 = Get-ScheduledTask -TaskName 'hydra-mine-gpu'
  '  hydra-mine-gpu action now: {0} {1}' -f $t2.Actions[0].Execute, $t2.Actions[0].Arguments
  '  trigger: {0} delay {1}  principal {2} / {3}' -f $t2.Triggers[0].CimClass.CimClassName, $t2.Triggers[0].Delay, $t2.Principal.UserId, $t2.Principal.LogonType
} else { '  hydra-mine-gpu NOT PRESENT' }
$c = Get-ScheduledTask -TaskName 'hydra-mine-cpu' -ErrorAction SilentlyContinue
if ($c) {
  if ($c.State -ne 'Disabled') { Disable-ScheduledTask -TaskName 'hydra-mine-cpu' | Out-Null }
  '  hydra-mine-cpu: {0}   (CPU stays free for installs and disk work)' -f (Get-ScheduledTask -TaskName 'hydra-mine-cpu').State
}

Section '3. Hydra in the Startup folder'
$startup = [Environment]::GetFolderPath('Startup')
$lnkPath = Join-Path $startup 'Hydra V2.lnk'
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($lnkPath)
$lnk.TargetPath = 'C:\AI\hydra-local\relaunch-hydra.cmd'
$lnk.WorkingDirectory = 'C:\AI\hydra-local'
$lnk.IconLocation = 'C:\AI\hydra-local\hydra.ico'
$lnk.Description = 'Hydra V2 - raises the shelf and opens the window'
$lnk.Save()
'  wrote: ' + $lnkPath + '  exists=' + (Test-Path $lnkPath)
Get-ChildItem $startup | ForEach-Object { '    startup: ' + $_.Name }

Section '4. no sleep, no hibernate, lid does nothing'
& powercfg /h off 2>&1 | Out-Null
& powercfg /change standby-timeout-ac 0
& powercfg /change monitor-timeout-ac 0
& powercfg /change disk-timeout-ac 0
& powercfg /change hibernate-timeout-ac 0
& powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
& powercfg /setdcvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
& powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP STANDBYIDLE 0
& powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP UNATTENDSLEEP 0
& powercfg /setactive SCHEME_CURRENT
Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -Name HiberbootEnabled -Value 0 -Type DWord
'  HiberbootEnabled: ' + (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power').HiberbootEnabled
$q = (& powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE) -join "`n"
'  STANDBYIDLE AC: ' + ([regex]::Match($q, 'Current AC Power Setting Index: (0x[0-9a-fA-F]+)').Groups[1].Value)
$ql = (& powercfg /query SCHEME_CURRENT SUB_BUTTONS LIDACTION) -join "`n"
'  LIDACTION   AC: ' + ([regex]::Match($ql, 'Current AC Power Setting Index: (0x[0-9a-fA-F]+)').Groups[1].Value)
'  hibernate file present: ' + (Test-Path 'C:\hiberfil.sys')

Section '5. what will happen at the next boot'
'  autologon: ' + ((Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon').AutoAdminLogon)
'  boot task jims-hydra-shelf: ' + (Get-ScheduledTask -TaskName 'jims-hydra-shelf' -ErrorAction SilentlyContinue).State
'  logon task hydra-mine-gpu : ' + (Get-ScheduledTask -TaskName 'hydra-mine-gpu' -ErrorAction SilentlyContinue).State
'  startup shortcut          : ' + (Test-Path $lnkPath)
'WIRE DONE'
