# From the screenshot: the "old menu" is the 980TI STUDIO console menu (from C:\Models\studio\start_studio.cmd via the
# Hydra-980ti-Studio-Logon task), not Hydra v1 — v1 is gone, v2's window is up and its status line already reads
# "GPU idle Service: Etchash 1.5 Mh/s (AI preempts)". What is missing is the share wall as a window: it is running but
# owns no window (handle 0), because a PowerShell started from a shortcut on Win11 can be hosted by Windows Terminal.
# The old stub used conhost.exe as the shortcut target and that produced a real console, so do that.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }

Section '1. the old menu off the login'
$x = Get-ScheduledTask -TaskName 'Hydra-980ti-Studio-Logon' -ErrorAction SilentlyContinue
if ($x) { Stop-ScheduledTask -TaskName 'Hydra-980ti-Studio-Logon' -ErrorAction SilentlyContinue; Disable-ScheduledTask -TaskName 'Hydra-980ti-Studio-Logon' -ErrorAction SilentlyContinue | Out-Null; '  Hydra-980ti-Studio-Logon -> Disabled' }
Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | Where-Object { ([string]$_.CommandLine) -match 'studio|echidna' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; '  stopped old menu cmd ' + $_.ProcessId }

Section '2. the wall shortcut must produce a console window'
$startup = [Environment]::GetFolderPath('Startup')
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut((Join-Path $startup 'Miner Wall.lnk'))
$s.TargetPath = 'C:\Windows\System32\conhost.exe'
$s.Arguments = 'powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -File "C:\AI\hydra-local\scripts\miner-wall.ps1" -ApiBase http://127.0.0.1:61235/'
$s.WorkingDirectory = 'C:\AI\hydra-local'
$s.WindowStyle = 1
$s.Save()
'  Miner Wall.lnk -> conhost.exe powershell.exe ... miner-wall.ps1 -ApiBase 61235'
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { ([string]$_.CommandLine) -match 'miner-wall' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; '  stopped old wall ' + $_.ProcessId }

Section '3. reboot so the login path is what gets tested'
& shutdown /r /f /t 5
'  reboot issued'
