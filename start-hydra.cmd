@echo off
REM ================================================================
REM  HEADLESS debug start — doors only, NO window.
REM
REM  This launcher starts nothing itself. The shell does it: ProcessWrapper
REM  hidden, then State / Services / ResourceManager as ProcessWrapper-owned
REM  processes, then Basic_App in-process — and stops because of --headless.
REM  Nothing is ever a free console window (the old five-window launcher is
REM  gone on purpose).
REM
REM  Normal use = open-hydra-window.cmd (same stack, WITH the window and its
REM  golden-layout tabs: Basic | service pages | Process).
REM ================================================================
set ELECTRON=C:\Users\User\AppData\Local\hermes\node\node_modules\electron\dist\electron.exe
if not exist "%ELECTRON%" (
  echo   No electron found at %ELECTRON%
  exit /b 1
)
cd /d C:\AI\hydra-local\module\Basic_App
start "hydra-headless" /min "%ELECTRON%" electron\main.cjs --headless
echo.
echo   Doors coming up hidden: 8125 PW . 8127 State . 8128 Services . 8129 RM . 8130 Basic
echo   Shelf face (open it yourself): http://127.0.0.1:8130/
echo   Catalog: http://127.0.0.1:8128/api/services   (reload: POST /api/services/reload)
echo   Stop: run stop-hydra.cmd
echo.
