@echo off
REM ================================================================
REM  THE Hydra window — the ONE entry point for the whole shelf.
REM
REM  Start this and nothing else. The shell (electron/main.cjs) raises
REM  every door itself: ProcessWrapper hidden, then State / Services /
REM  ResourceManager as ProcessWrapper-owned processes, then Basic_App
REM  in-process — so each console is a TAB inside this window
REM  (golden-layout: Basic | service pages | Process), never a loose
REM  console window on the desktop.
REM
REM  Extra service tabs are declared in:
REM    module\Basic_App\electron\tabs.json
REM
REM  Close the window = everything pops (PW /api/stop takes the children).
REM  Headless, no window, for debugging only: start-hydra.cmd
REM ================================================================
set ELECTRON=C:\Users\User\AppData\Local\hermes\node\node_modules\electron\dist\electron.exe
if not exist "%ELECTRON%" (
  echo   No electron found at %ELECTRON%
  echo   Point this line at any electron.exe and run again.
  pause
  exit /b 1
)
cd /d C:\AI\hydra-local\module\Basic_App
start "" "%ELECTRON%" electron\main.cjs
echo   Hydra window starting — the shell raises the doors hidden and tabs them inside.
