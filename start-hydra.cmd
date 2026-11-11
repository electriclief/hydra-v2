@echo off
REM =====================================================================================
REM  HYDRA V2 - the ONE launcher. Every node runs this same file from the Startup folder.
REM
REM  It decides nothing about the node beyond what the node already is:
REM    - an Electron build present  -> the shelf WITH its window (what a person stands in front of)
REM    - no Electron                -> shelf-headless.mjs, same doors, same rows, no window
REM  Both paths raise ProcessWrapper and every door through it, and the shelf hands the mining
REM  line to the monitor when node.json declares a miner. So the menu and the monitor are state,
REM  not a per-node arrangement: nothing in this file knows a machine name, an IP or a card.
REM
REM  Idempotent: a door already answering is adopted, never restarted; a second shelf exits.
REM =====================================================================================
setlocal
cd /d "%~dp0"
if not exist "logs" mkdir "logs"

set "NODE=%~dp0tools\node\node.exe"
if not exist "%NODE%" set "NODE=node"

set "ELECTRON="
if exist "%LOCALAPPDATA%\hermes\node\node_modules\electron\dist\electron.exe" set "ELECTRON=%LOCALAPPDATA%\hermes\node\node_modules\electron\dist\electron.exe"
if exist "%~dp0tools\electron\electron.exe" set "ELECTRON=%~dp0tools\electron\electron.exe"

if defined ELECTRON (
  echo   electron: %ELECTRON%
  echo   raising the shelf with a window
  start "" "%ELECTRON%" "%~dp0module\Basic_App\electron\main.cjs"
  exit /b 0
)

echo   no electron on this node - raising the shelf headless
"%NODE%" "%~dp0shelf-headless.mjs" >> "%~dp0logs\shelf-boot.log" 2>&1
