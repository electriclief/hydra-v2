@echo off
REM Start the Echidna talk door (8138) on this node, detached, logging to logs\echidna.log.
REM The door is a door: it serves a page and an SSE stream, so it must outlive the shell that asked for it.
cd /d "C:\AI\hydra-local\module\Echidna"
REM node is INSTANCE data on purpose - 123 ships its own under %LOCALAPPDATA%\hermes\node, robert uses the system install.
REM Hardcoding one path is how a launcher works on the machine it was written on and nowhere else.
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" for /f "delims=" %%i in ('where node 2^>nul') do set "NODE=%%i"
if not exist "%NODE%" set "NODE=C:\Users\User\AppData\Local\hermes\node\node.exe"
if not exist "%NODE%" (
  echo [%DATE% %TIME%] no node.exe found - tried system install, PATH and the hermes node>>"C:\AI\hydra-local\logs\echidna.log"
  exit /b 1
)
"%NODE%" public\js\main.js >> "C:\AI\hydra-local\logs\echidna.log" 2>&1
