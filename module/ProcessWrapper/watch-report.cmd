@echo off
title Hydra - ProcessWrapper : watch report
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\watch-report.ps1"
echo.
pause
