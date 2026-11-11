@echo off
setlocal
REM ==================================================================
REM  HYDRA V2 - relaunch on XPSW (192.168.1.107). Desktop shortcut and
REM  Startup item point here.
REM
REM  This node carries its own runtimes: tools\node (v26.12.1) and
REM  tools\electron, so nothing is borrowed from a Hermes install that
REM  may not exist here. HYDRA_NODE is set because Basic_App spawns every
REM  door as `node <script>` and this box has no node on PATH.
REM
REM  Every click is logged to logs\relaunch.log
REM ==================================================================
set "ROOT=C:\AI\hydra-local"
set "ELECTRON=%ROOT%\tools\electron\electron.exe"
set "NODE=%ROOT%\tools\node\node.exe"
set "APP=%ROOT%\module\Basic_App\electron\main.cjs"
set "HYDRA_NODE=%NODE%"
set "SLEEP=ping -n 2 127.0.0.1"

call :note "click"

if not exist "%ELECTRON%" ( call :note "ABORT: no electron at %ELECTRON%" & echo   missing %ELECTRON% & exit /b 1 )
if not exist "%NODE%"     ( call :note "ABORT: no node at %NODE%" & echo   missing %NODE% & exit /b 1 )
if not exist "%APP%"      ( call :note "ABORT: no app at %APP%" & echo   missing %APP% & exit /b 1 )

call :doorup
if not errorlevel 1 ( call :note "doors already answering - opening a window that will adopt them" ) else ( call :note "doors down - the window will raise them" )

cd /d "%ROOT%\module\Basic_App"
start "" /b cmd /c ""%ELECTRON%" "%APP%" >> "%ROOT%\logs\electron.log" 2>&1"
call :note "window launched"

REM 200 s, not 60: measured on this box, ProcessWrapper alone can take 70 s on a cold boot (Defender first scan) and
REM the app UI door only opens after every other door is up -- 19:23:10 click -> 19:24:30+ before :8130 answered,
REM so the old 60 s budget printed "FAILED" on a boot that had already succeeded. A false failure line on the
REM operator's desktop is worse than no line at all.
call :waitdoor 200
if errorlevel 1 ( call :note "FAILED: no door on :8130 after 200s" & echo   No door answered on 8130 after 200s. ) else ( call :note "app ready: :8130 answering" )
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
