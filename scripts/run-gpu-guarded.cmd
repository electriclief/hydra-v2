@echo off
REM ==========================================================================
REM  GPU mining, started once per logon by task "hydra-mine-gpu".
REM
REM  Guarded, because a logon task can fire more than once (auto-logon signs
REM  the user back in after a sign-out, and a manual start may already be
REM  running). Two SRBMiner processes on one 2 GB card means both crawl and
REM  the shares split - the exact duplicate-launch failure that bit miner1.
REM  If a miner is already up, this exits and records why.
REM ==========================================================================
set "LOG=C:\AI\miners\logs\start-guard.log"
tasklist /FI "IMAGENAME eq SRBMiner-MULTI.exe" 2>nul | find /I "SRBMiner-MULTI.exe" >nul
if not errorlevel 1 (
  echo %DATE% %TIME% miner already running - not starting a second>>"%LOG%"
  exit /b 0
)
echo %DATE% %TIME% starting run-gpu.cmd>>"%LOG%"
call "C:\AI\miners\run-gpu.cmd"
