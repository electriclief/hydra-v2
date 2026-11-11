@echo off
REM Raise Core and Mirror on the 1660 box. Started detached by WMI so it outlives any ssh session.
REM A .cmd is used because a nested command line through schtasks/WMI mangles quotes; this file is fixed text.
set "NODE=C:\Program Files\nodejs\node.exe"
set "ROOT=C:\AI\hydra-local"
cd /d "%ROOT%\module\Core"
start "" /b "%NODE%" src/main.js --port 8136 --host 0.0.0.0 >> "%ROOT%\logs\core.log" 2>&1
cd /d "%ROOT%\module\Mirror"
start "" /b "%NODE%" src/main.js --port 8137 --host 0.0.0.0 >> "%ROOT%\logs\mirror.log" 2>&1
