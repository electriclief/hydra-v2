@echo off
REM ================================================================
REM  Stop the local Hydra V2 shelf on node 123 - by PORT, so it
REM  cannot take an unrelated node process with it.
REM ================================================================
for %%P in (8125 8127 8128 8129 8130) do call :killport %%P
echo.
echo   Doors stopped (8125 8127 8128 8129 8130).
echo   Render engines started BY a run (sd-cli, sd-server, python) are NOT
echo   touched here - stop those from the shelf (Stop) or llmctl.ps1.
pause
exit /b

:killport
setlocal EnableDelayedExpansion
set P=%~1
set FOUND=
for /f "tokens=5" %%A in ('netstat -ano ^| findstr /r /c:"LISTENING" ^| findstr /c:":%P% "') do (
  if not "%%A"=="0" if not defined FOUND (
    set FOUND=%%A
    echo   port %P%  ^-^>  pid %%A
    taskkill /PID %%A /F >nul 2>&1
  )
)
if not defined FOUND echo   port %P%  -  nothing listening
endlocal
exit /b 0
