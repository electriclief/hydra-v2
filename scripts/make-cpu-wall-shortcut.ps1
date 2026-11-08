# Startup shortcut for the CPU wall row. Written as a file because the one-liner through ssh gets its quotes eaten.
$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'CPU Wall.lnk'
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$s.TargetPath = 'powershell.exe'
$s.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File C:\AI\hydra-local\scripts\start-cpu-wall-row.ps1'
$s.WorkingDirectory = 'C:\AI\hydra-local'
$s.WindowStyle = 7
$s.IconLocation = 'powershell.exe,0'
$s.Description = 'robert - cpu : the CPU miner share wall'
$s.Save()

# read it back: a shortcut that was written but points nowhere is worse than none
$check = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
'target : ' + $check.TargetPath
'args   : ' + $check.Arguments
'style  : ' + $check.WindowStyle
'exists : ' + (Test-Path $lnk)
