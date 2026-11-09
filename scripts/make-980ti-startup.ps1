## Hydra + the mining proof window on gtx-980ti - start both, on boot, visibly.
## Two shortcuts in the operator's Startup folder:
##   Hydra V2.lnk        -> start-hydra-980.cmd   (the app and every door)
##   Mining wall.lnk     -> conhost + powershell -NoExit -File scripts\miner-wall.ps1
## The wall is a window with an X button, not a scheduled task - the operator's rule:
## nothing runs that cannot be seen and closed.
$ErrorActionPreference = 'Stop'
$root = 'C:\AI\hydra-local'
$startup = [Environment]::GetFolderPath('Startup')
$sh = New-Object -ComObject WScript.Shell

function New-Lnk($name, $target, $arguments, $workdir, $icon) {
  $p = Join-Path $startup $name
  $l = $sh.CreateShortcut($p)
  $l.TargetPath = $target
  if ($arguments) { $l.Arguments = $arguments }
  if ($workdir)   { $l.WorkingDirectory = $workdir }
  if ($icon)      { $l.IconLocation = $icon }
  $l.Description = $name
  $l.Save()
  '{0}  -> {1} {2}' -f $p, $target, $arguments
}

New-Lnk 'Hydra V2.lnk' (Join-Path $root 'start-hydra-980.cmd') '' $root (Join-Path $root 'hydra.ico')
New-Lnk 'Mining wall.lnk' 'C:\Windows\System32\conhost.exe' ('powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -File "' + (Join-Path $root 'scripts\miner-wall.ps1') + '"') $root ''

'--- Startup folder now holds:'
Get-ChildItem $startup -Filter *.lnk | Select-Object Name, LastWriteTime | Format-Table -AutoSize | Out-String
