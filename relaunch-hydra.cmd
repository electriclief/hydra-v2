@echo off
setlocal
REM ==================================================================
REM  HYDRA V2 (this node: 192.168.1.123) - relaunch.
REM  The desktop shortcut "Hydra V2" points here.
REM
REM  This machine's shell owns its own doors: electron/main.cjs raises
REM  them on first launch and ADOPTS them if they are already answering
REM  (ensureDoors). It also holds a single-instance lock, so a second
REM  click focuses the window that is already open instead of starting
REM  a rival stack. That makes launch == relaunch here.
REM
REM  Runtime is borrowed from Hermes on this node (unlike Jim's laptop,
REM  which carries tools\electron inside the instance).
REM
REM  Every click is logged to logs\relaunch.log
REM ==================================================================
set "ELECTRON=C:\Users\User\AppData\Local\hermes\node\node_modules\electron\dist\electron.exe"
set "APP=C:\AI\hydra-local\module\Basic_App\electron\main.cjs"
set "ROOT=C:\AI\hydra-local"
REM No "timeout" here: without a console input handle it exits immediately ("Input redirection is not
REM supported"), which silently turns a 45-second wait into 45 instant tries. ping -n 2 always waits ~1s.
set "SLEEP=ping -n 2 127.0.0.1"

call :note "click"

if not exist "%ELECTRON%" (
  call :note "ABORT: electron missing at %ELECTRON%"
  echo   No electron at %ELECTRON%
  echo   Reinstall Hermes' electron package, or point this line at any electron.exe.
  pause
  exit /b 1
)
if not exist "%APP%" (
  call :note "ABORT: app missing at %APP%"
  echo   No app at %APP%
  pause
  exit /b 1
)

call :doorup
if not errorlevel 1 (
  call :note "doors already answering - opening a window that will adopt them"
) else (
  call :note "doors are down - the window will raise them"
)

cd /d "%ROOT%\module\Basic_App"
start "" /b cmd /c ""%ELECTRON%" "%APP%" >> "%ROOT%\logs\electron.log" 2>&1"
call :note "window launched"

REM this box takes ~25s to raise all nine doors, and 8130 (the app's own door) comes up last -
REM that is the honest signal that the app is really ready, not just that a window exists
call :waitdoor 45
if errorlevel 1 (
  call :note "FAILED: no door on :8130 after 45s - check the Hydra window for an error"
  echo   No door answered on 8130 after 45s. Check the Hydra window for the error.
) else (
  call :note "app ready: :8130 answering"
)
exit /b 0

:doorup
netstat -ano -p tcp | findstr /c:":8130 " | findstr /i "LISTEN" >nul 2>&1
exit /b %errorlevel%

:waitdoor
for /L %%i in (1,1,%1) do (
  call :doorup
  if not errorlevel 1 exit /b 0
  %SLEEP% >nul 2>&1
)
exit /b 1

:note
if not exist "%ROOT%\logs" mkdir "%ROOT%\logs" >nul 2>&1
echo [%DATE% %TIME%] %~1>>"%ROOT%\logs\relaunch.log"
exit /b 0
