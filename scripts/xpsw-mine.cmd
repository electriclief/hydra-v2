@echo off
REM Idle mining for XPSW - started by the standby guard when the card has had no AI work for 30 minutes.
REM ETCHASH on the GTX 1060 6 GB: measured 96 W and 82 C at steady state with the fan rack fitted.
cd /d "C:\AI\miners\lolminer"
"C:\AI\miners\lolminer\lolMiner.exe" --algo ETCHASH --pool etchash.unmineable.com:3333 --user leafdriving2.unmineable_miner_xpsw --pass x --apiport 60151 --nocolor >> "C:\AI\logs\xpsw-miner.log" 2>&1
