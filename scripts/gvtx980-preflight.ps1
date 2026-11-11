# The reason every capture on this box "failed" was mundane and I should have checked it first: C:\AI\reports does not
# exist here, so the PNG had nowhere to land — the failures were a missing folder, not a broken desktop.
# And the reason the wall had no window: a process started by the Task Scheduler gets no console window even with an
# interactive principal (main window handle 0). A window has to come from Explorer, i.e. from the Startup shortcut —
# which is exactly how the old "Mining wall" stub did it.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$ps = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$wall = 'C:\AI\hydra-local\scripts\miner-wall.ps1'
$png = 'C:\AI\reports\gvtx980-screen.png'

Section '1. make the folder that was missing'
New-Item -ItemType Directory -Path 'C:\AI\reports' -Force | Out-Null
'  C:\AI\reports exists: ' + (Test-Path 'C:\AI\reports')

Section '2. the Startup shortcut must be the thing that opens the window'
$startup = [Environment]::GetFolderPath('Startup')
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut((Join-Path $startup 'Miner Wall.lnk'))
$s.TargetPath = $ps
$s.Arguments = '-NoProfile -NoExit -ExecutionPolicy Bypass -File "' + $wall + '" -ApiBase http://127.0.0.1:61235/'
$s.WorkingDirectory = 'C:\AI\hydra-local'
$s.WindowStyle = 1
$s.Save()
'  Miner Wall.lnk -> ' + $s.TargetPath + ' ' + $s.Arguments
Get-ChildItem $startup | ForEach-Object { '  startup: ' + $_.Name }

Section '3. stop the task-scheduler wall starters so nothing double-launches'
foreach ($t in 'gvtx980-wall-now','gvtx980-wall','gvtx980-shot','gvtx980-shot2','gvtx980-shot3','gvtx980-shot4','gvtx980-shot5','gvtx980-wake') {
  if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $t -Confirm:$false -ErrorAction SilentlyContinue; '  removed task ' + $t }
}
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { ([string]$_.CommandLine) -match 'miner-wall' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; '  stopped headless wall pid ' + $_.ProcessId }

Section '4. boot it for real — Explorer opens the wall, the guard starts the miner'
& shutdown /r /f /t 5
'  reboot issued'
