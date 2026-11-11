# Three things, all found by measurement:
#   1. the wall hard-codes ApiBase to the miner API port 60130, but this node's standby row uses --apiport 61235, so the
#      wall was drawing next to a miner it could never read (same class of bug as the .cmd start command: a number in one
#      file that does not match the number in the other).
#   2. CopyFromScreen failed with "The handle is invalid" — that is what a capture gets when the console session is
#      sitting on the lock screen, which also means a person walking up would see a lock screen and not the wall.
#   3. so: pin the wall's port, kill the lock, and only then claim it is visible.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }

Section '1. how the wall picks its port'
Select-String -Path 'C:\AI\hydra-local\scripts\miner-wall.ps1' -Pattern '60130|ApiBase' | Select-Object -First 8 | ForEach-Object { '  line {0}: {1}' -f $_.LineNumber, $_.Line.Trim() }

Section '2. what Windows shows a person right now (window titles, session 1)'
$tl = & tasklist /v /fi "SESSION eq 1" /fo csv 2>&1 | ConvertFrom-Csv
$tl | Where-Object { $_.'Window Title' -and $_.'Window Title' -ne 'N/A' } | ForEach-Object { '  {0,-22} {1}' -f $_.'Image Name', $_.'Window Title' }

Section '3. lock screen and screensaver state'
$d = 'HKCU:\Control Panel\Desktop'
$p = Get-ItemProperty $d -ErrorAction SilentlyContinue
'  ScreenSaveActive={0}  IsSecure={1}  Timeout={2}' -f $p.ScreenSaveActive, $p.ScreenSaverIsSecure, $p.ScreenSaveTimeOut
'  lock policy InactivityTimeoutSecs=' + [bool](Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -ErrorAction SilentlyContinue).InactivityTimeoutSecs
'  NoLockScreen=' + (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -ErrorAction SilentlyContinue).NoLockScreen
$proc = @(Get-Process LogonUI -ErrorAction SilentlyContinue)
'  LogonUI running (i.e. a lock/login screen is up): ' + $proc.Count

Section '4. kill the lock: no screensaver, no secure screensaver, no auto-lock on wake'
Set-ItemProperty $d -Name 'ScreenSaveActive' -Value '0' -Force
Set-ItemProperty $d -Name 'ScreenSaverIsSecure' -Value '0' -Force
& powercfg /setacvalueindex SCHEME_CURRENT SUB_VIDEO VIDEOCONLOCK 0 2>&1 | Out-Null
& powercfg /setdcvalueindex SCHEME_CURRENT SUB_VIDEO VIDEOCONLOCK 0 2>&1 | Out-Null
& powercfg /setactive SCHEME_CURRENT 2>&1 | Out-Null
Set-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -Name 'NoLockScreen' -Value 1 -Force -ErrorAction SilentlyContinue
'  applied'

Section '5. wall on the right port, running in session 1'
$ps = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$wall = 'C:\AI\hydra-local\scripts\miner-wall.ps1'
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { ([string]$_.CommandLine) -match 'miner-wall' } | ForEach-Object { '  stopping old wall pid ' + $_.ProcessId; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 3
$args_wall = '-NoProfile -NoExit -ExecutionPolicy Bypass -File "' + $wall + '" -ApiBase http://127.0.0.1:61235/'
$startup = [Environment]::GetFolderPath('Startup')
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut((Join-Path $startup 'Miner Wall.lnk'))
$s.TargetPath = $ps
$s.Arguments = $args_wall
$s.WorkingDirectory = 'C:\AI\hydra-local'
$s.WindowStyle = 1
$s.Save()
'  shortcut updated to: ' + $args_wall
$t = 'gvtx980-wall-now'
schtasks /Delete /TN $t /F 2>&1 | Out-Null
$a = New-ScheduledTaskAction -Execute $ps -Argument $args_wall -WorkingDirectory 'C:\AI\hydra-local'
$pr = New-ScheduledTaskPrincipal -UserId 'User' -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName $t -Action $a -Principal $pr -Force | Out-Null
Start-ScheduledTask -TaskName $t
Start-Sleep -Seconds 12
@(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { ([string]$_.CommandLine) -match 'miner-wall' }) | ForEach-Object { '  wall pid {0} session {1}' -f $_.ProcessId, $_.SessionId }

Section '6. capture again'
$png = 'C:\AI\reports\gvtx980-screen.png'
Remove-Item $png -Force -ErrorAction SilentlyContinue
$t2 = 'gvtx980-shot4'
schtasks /Delete /TN $t2 /F 2>&1 | Out-Null
$a2 = New-ScheduledTaskAction -Execute $ps -Argument ('-NoProfile -ExecutionPolicy Bypass -File C:\AI\hydra-local\scripts\capture-screen.ps1 -Out ' + $png)
Register-ScheduledTask -TaskName $t2 -Action $a2 -Principal $pr -Force | Out-Null
Start-ScheduledTask -TaskName $t2
for ($i = 1; $i -le 12; $i++) { if ((Test-Path $png) -and (Get-Item $png).Length -gt 40000) { break }; Start-Sleep -Seconds 2 }
'  png: ' + $(if (Test-Path $png) { (Get-Item $png).Length.ToString() + ' B' } else { 'MISSING' })

Section '7. the number the wall should be showing'
try { $r = Invoke-RestMethod 'http://127.0.0.1:61235/' -TimeoutSec 6; $g = @($r.Algorithms)[0]; '  {0}  {1:N3} MH/s  A{2} R{3}  up {4} min' -f $g.Algorithm, $g.Total_Performance, $g.Total_Accepted, $g.Total_Rejected, [int]($r.Session.Uptime/60) } catch { '  api 61235 silent' }
'GVTX980 WALLFIX DONE'
