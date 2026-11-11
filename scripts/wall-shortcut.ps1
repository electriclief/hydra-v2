$ErrorActionPreference = 'Continue'
$wall = 'C:\AI\hydra-local\scripts\miner-wall.ps1'
'wall script: ' + (Test-Path $wall)
if (Test-Path $wall) {
  $startup = [Environment]::GetFolderPath('Startup')
  $sh = New-Object -ComObject WScript.Shell
  $s = $sh.CreateShortcut((Join-Path $startup 'Miner Wall.lnk'))
  $s.TargetPath = 'C:\Windows\System32\conhost.exe'
  $s.Arguments = 'powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -File "' + $wall + '" -ApiBase http://127.0.0.1:60131/'
  $s.WorkingDirectory = 'C:\AI\hydra-local'
  $s.WindowStyle = 1
  $s.Save()
  'wrote Miner Wall.lnk -> api 60131'
}
Get-ChildItem ([Environment]::GetFolderPath('Startup')) | ForEach-Object { '  startup: ' + $_.Name }
'WALL SHORTCUT DONE'
