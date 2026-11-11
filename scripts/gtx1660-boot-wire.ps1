# gtx-1660 has no Electron and no display (nvidia-smi display_active = Disabled, session 1 disconnected), so a Hydra
# window there would have nothing to draw on and every launcher that needs electron.exe aborts. The doors are plain
# node, and shelf-headless.mjs is the no-Electron path that raises ProcessWrapper and every other door through it.
# This node therefore boots the shelf headless and keeps the wall as the thing with a window.
$ErrorActionPreference = 'Continue'
$root = 'C:\AI\hydra-local'
$node = Join-Path $root 'tools\node\node.exe'
$cmd = Join-Path $root 'start-hydra-1660.cmd'

$content = @'
@echo off
REM =====================================================================================
REM  HYDRA V2 on gtx-1660 - headless shelf. This box has no Electron and no display,
REM  so the doors are raised by node (shelf-headless.mjs) and the wall is what has a window.
REM  Idempotent: a door already answering is adopted, never restarted.
REM =====================================================================================
setlocal
cd /d C:\AI\hydra-local
if not exist logs mkdir logs
set "HYDRA_NODE=C:\AI\hydra-local\tools\node\node.exe"
set "HYDRA_MODULE_ROOT=C:\AI\hydra-local\module"
if not exist "%HYDRA_NODE%" (
  echo   no node runtime at %HYDRA_NODE%
  exit /b 1
)
"%HYDRA_NODE%" shelf-headless.mjs >> logs\shelf-boot.log 2>&1
'@
[System.IO.File]::WriteAllText($cmd, $content, (New-Object System.Text.UTF8Encoding($false)))
'wrote ' + $cmd
'node present: ' + (Test-Path $node) + '  ' + $(if (Test-Path $node) { (& $node -v) } else { '' })

$startup = [Environment]::GetFolderPath('Startup')
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut((Join-Path $startup 'Hydra V2.lnk'))
$s.TargetPath = 'C:\Windows\System32\conhost.exe'
$s.Arguments = '"' + $cmd + '"'
$s.WorkingDirectory = $root
$s.WindowStyle = 7
$s.Save()
'Hydra V2.lnk -> conhost ' + $cmd
Get-ChildItem $startup | ForEach-Object { '  startup: ' + $_.Name }

'--- dry run now, so the boot is not the first attempt'
& $cmd
Start-Sleep -Seconds 30
$ports = @(8125, 8127, 8128, 8130, 8136, 8137, 8138)
$up = @(); foreach ($p in $ports) { if (Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue) { $up += $p } }
'doors now: ' + $up.Count + '/' + $ports.Count + ' -> ' + ($up -join ' ')
try { $c = (Invoke-RestMethod 'http://127.0.0.1:8138/api/monitor' -TimeoutSec 6).monitor.card; 'monitor: ' + $(if ($c) { '[' + $c.kind + '] ' + $c.title + ' - ' + $c.text } else { 'empty board' }) } catch { 'monitor: not answering' }
'shelf log tail:'
Get-Content (Join-Path $root 'logs\shelf-boot.log') -Tail 6 -ErrorAction SilentlyContinue | ForEach-Object { '  ' + $_ }
'GTX1660 HEADLESS BOOT WIRED'
