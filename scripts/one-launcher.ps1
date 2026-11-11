# One launcher for every node: the Startup shortcut runs start-hydra.cmd, which raises the shelf with a window when this
# box has Electron and headless when it does not. No per-node launcher files, no machine names in the boot path.
$ErrorActionPreference = 'Continue'
$root = 'C:\AI\hydra-local'
'host: ' + $env:COMPUTERNAME
'  shelf-headless.mjs: ' + (Test-Path (Join-Path $root 'shelf-headless.mjs'))
'  start-hydra.cmd: ' + (Test-Path (Join-Path $root 'start-hydra.cmd'))

$startup = [Environment]::GetFolderPath('Startup')
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut((Join-Path $startup 'Hydra V2.lnk'))
$s.TargetPath = 'C:\Windows\System32\cmd.exe'
$s.Arguments = '/c "' + (Join-Path $root 'start-hydra.cmd') + '"'
$s.WorkingDirectory = $root
$s.WindowStyle = 7
$s.Save()
'Hydra V2.lnk -> cmd /c start-hydra.cmd'

# the per-node launcher I made earlier is exactly the drift this replaces
foreach ($f in 'start-hydra-1660.cmd', 'start-hydra-980.cmd') {
  $p = Join-Path $root $f
  if (Test-Path $p) { Remove-Item $p -Force; '  removed per-node launcher ' + $f }
}

'--- run it now, in the console session'
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', ('"' + (Join-Path $root 'start-hydra.cmd') + '"') -WorkingDirectory $root -WindowStyle Hidden
Start-Sleep -Seconds 45
$ports = @(8125, 8127, 8128, 8130, 8133, 8136, 8137, 8138)
$up = @(); foreach ($p in $ports) { if (Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue) { $up += $p } }
'doors: ' + $up.Count + '/' + $ports.Count + ' -> ' + ($up -join ' ')
try { $rows = @((Invoke-RestMethod 'http://127.0.0.1:8125/api/processes' -TimeoutSec 8).processes | Where-Object { $_.life -eq 'running' }); 'rows: ' + $rows.Count + ' (' + (($rows | ForEach-Object { $_.name }) -join ', ') + ')' } catch { 'rows: pw not answering' }
try { $c = (Invoke-RestMethod 'http://127.0.0.1:8138/api/monitor' -TimeoutSec 6).monitor.card; 'monitor: ' + $(if ($c) { '[' + $c.kind + '] ' + $c.title + ' - ' + $c.text } else { 'empty board' }) } catch { 'monitor: not answering' }
'shelf log tail:'
Get-Content (Join-Path $root 'logs\shelf-boot.log') -Tail 10 -ErrorAction SilentlyContinue | ForEach-Object { '  ' + $_ }
'ONE LAUNCHER DONE'
