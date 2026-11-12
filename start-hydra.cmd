@echo off
REM =====================================================================================
REM  HYDRA V2 - the ONE launcher. Every node runs this same file from the Startup folder.
REM
REM  A node that CAN show a window SHOULD show a window. The order is:
REM
REM    1. Electron here or in the tools folder       -> the shelf WITH its window
REM    2. no Electron, node.json does not say small   -> SUPPLY one: scripts/ensure-electron.ps1
REM                                                     fetches electron-win.zip from the controller,
REM                                                     expands it, then launches the window
REM    3. node.json declares  "headless": true        -> shelf-headless.mjs, and the log says why.
REM                                                     That switch is for the low-RAM, low-CPU
REM                                                     machines - not for anything that merely
REM                                                     lacks the runtime.
REM
REM  The window is not decoration: the Electron app's row table is what raises standby-guard,
REM  and the guard is what owns the miner. Both shelf paths raise ProcessWrapper and every door
REM  through it, and the shelf hands the mining line to the monitor when node.json declares a
REM  miner. So the menu and the monitor are state, not a per-node arrangement.
REM
REM  Idempotent: a door already answering is adopted, never restarted; a second shelf exits.
REM =====================================================================================
setlocal
cd /d "%~dp0"
if not exist "logs" mkdir "logs"

set "NODE=%~dp0tools\node\node.exe"
if not exist "%NODE%" set "NODE=node"

set "ELECTRON="
if exist "%~dp0tools\electron\electron.exe" set "ELECTRON=%~dp0tools\electron\electron.exe"
if exist "%LOCALAPPDATA%\hermes\node\node_modules\electron\dist\electron.exe" set "ELECTRON=%LOCALAPPDATA%\hermes\node\node_modules\electron\dist\electron.exe"

if not defined ELECTRON (
  if not defined HYDRA_CONTROLLER set "HYDRA_CONTROLLER=http://192.168.1.123:8140"
  echo   no electron here - supplying one from %HYDRA_CONTROLLER%
  for /f "usebackq tokens=1,* delims==" %%A in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ensure-electron.ps1" -Root "%~dp0." -Controller "%HYDRA_CONTROLLER%"`) do (
    if /i "%%A"=="ELECTRON" if not "%%B"=="" set "ELECTRON=%%B"
    if /i "%%A"=="WHY" echo   not supplying one: %%B
  )
)

if defined ELECTRON (
  echo   electron: %ELECTRON%
  echo   raising the shelf with a window
  start "" "%ELECTRON%" "%~dp0module\Basic_App\electron\main.cjs"
  exit /b 0
)

echo   raising the shelf headless - no window (declared small, or none could be supplied)  [%DATE% %TIME%] >> "%~dp0logs\shelf-boot.log"
echo   raising the shelf headless (see logs\shelf-boot.log)
"%NODE%" "%~dp0shelf-headless.mjs" >> "%~dp0logs\shelf-boot.log" 2>&1
