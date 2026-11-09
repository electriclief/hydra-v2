@echo off
REM Open the mining proof window on the desktop: a console with its own X button, drawing shares from
REM data\standby\guard.log and the miner's API. Closing it does not stop the miner (the guard owns that);
REM the window is the evidence, the Process tab is the control.
start "" "C:\Windows\System32\conhost.exe" powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -File "C:\AI\hydra-local\scripts\miner-wall.ps1"
