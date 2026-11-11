@echo off
REM ==================================================================
REM  miner1 (GTX 1650 4 GB) - the idle-mining command, staged and ready.
REM
REM  Algorithm choice is measured, not guessed: jims' 2 GB GTX 1050 mines
REM  xelishashv3 at 1,375 MiB with 4,337 accepted shares in 74.6 h, and this
REM  3.8.0, not 3.8.6: 3.8.6 dies on Turing with "GPU recovery failed; ref=RDEB6381D". Etchash is NOT an option here:
REM  its DAG is 4,447 MB at the current epoch and this card has 4,096 MB.
REM
REM  Same pool and worker shape as every other card in the house; only the
REM  worker tag changes, so one unMineable account keeps every card's shares.
REM ==================================================================
set "SRB=C:\AI\miners\srb380\SRBMiner-MULTI.exe"
set "LOG=C:\AI\logs\gpu.log"

cd /d C:\AI\miners\srb380
"%SRB%" ^
  --algorithm xelishashv3 ^
  --pool stratum+tcp://xelishash.unmineable.com:3333 ^
  --wallet leafdriving2.unmineable_miner_1650 ^
  --disable-cpu ^
  --api-enable --api-port 60202 ^
  --gpu-sensors-disable ^
  --disable-worker-watchdog ^
  --log-file "%LOG%"

REM If the card ever reports a DAG/memory error instead of a hashrate, the fallbacks in this order are:
REM   --algorithm autolykos2 --pool stratum+tcp://autolykos.unmineable.com:3333   (~2.2 GB DAG)
REM   --algorithm zelhash    --pool stratum+tcp://zelhash.unmineable.com:3333     (~2.5 GB, only if that host resolves)
pause
