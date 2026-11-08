@echo off
REM Run the Echidna pane UI test. Started from a .cmd on purpose: passing an http URL straight from git-bash to a native
REM exe dies with exit 127 and no output at all, which looks like a broken test rather than a broken shell.
set "ELECTRON=C:\Users\User\AppData\Local\hermes\node\node_modules\electron\dist\electron.exe"
"%ELECTRON%" "C:\Users\User\AppData\Local\hermes\cache\scratch\ech-shot.cjs" "http://127.0.0.1:8138/?embed=1" "C:\AI\ads\ech" "In one sentence: what is this machine doing right now?" > "C:\AI\ads\ech\test.log" 2>&1
echo exit %ERRORLEVEL% >> "C:\AI\ads\ech\test.log"
