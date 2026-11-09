@echo off
REM ==================================================================
REM  HYDRA V2 on gtx-980ti (192.168.1.134) - the ONE launcher.
REM
REM  This box borrows an electron copy from C:\AI\hydra-local\tools\electron
REM  (there is no hermes electron package here), so the path differs from
REM  the other nodes. Everything else is the same shell: it raises
REM  ProcessWrapper (8125) hidden, then State (8127) / Services (8128) /
REM  ResourceManager (8129) as ProcessWrapper-owned rows, then Basic_App,
REM  and finally the standby-guard watchdog declared in electron/main.cjs -
REM  which is what starts the idle miner when the card is free.
REM ==================================================================
set "ROOT=C:\AI\hydra-local"
set "ELECTRON=%ROOT%\tools\electron\electron.exe"
set "APP=%ROOT%\module\Basic_App\electron\main.cjs"

if not exist "%ELECTRON%" (
  echo   No electron at %ELECTRON%
  pause
  exit /b 1
)
if not exist "%APP%" (
  echo   No app at %APP%
  pause
  exit /b 1
)

REM already up? adopt instead of starting a rival stack
netstat -ano -p tcp | findstr /c:":8130 " | findstr /i "LISTEN" >nul 2>&1
if not errorlevel 1 (
  echo   Hydra is already answering on 8130 - open http://127.0.0.1:8130/
  exit /b 0
)

if not exist "%ROOT%\logs" mkdir "%ROOT%\logs" >nul 2>&1
echo [%DATE% %TIME%] launch>>"%ROOT%\logs\relaunch.log"

cd /d "%ROOT%\module\Basic_App"
start "" "%ELECTRON%" "%APP%"
echo   Hydra window starting - doors raise themselves (8125 PW, 8127 State, 8130 Basic)
