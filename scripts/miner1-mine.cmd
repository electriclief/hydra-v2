@echo off
REM ==================================================================
REM  miner1 - the rig's idle-mining command. One worker name for the whole box,
REM  so unMineable aggregates every card installed here instead of per-card tags.
REM
REM  Algorithm is measured, not assumed: xelishashv3 uses ~1.35 GB per card
REM  (verified on jims' 2 GB GTX 1050: 4,337 accepted shares in 74.6 h), so every
REM  card from 2 GB up works. Etchash is excluded on 4 GB cards - its DAG is
REM  4,447 MB at the current epoch and does not fit.
REM
REM  SRBMiner drives all detected cards by default; --gpu-id can pin one.
REM ==================================================================
set "SRB=C:\AI\miners\srb380\SRBMiner-MULTI.exe"
set "LOG=C:\AI\logs\gpu.log"

cd /d C:\AI\miners\srb380
"%SRB%" ^
  --algorithm xelishashv3 ^
  --pool stratum+tcp://xelishash.unmineable.com:3333 ^
  --wallet leafdriving2.unmineable_miner_miner1 ^
  --disable-cpu ^
  --api-enable --api-port 60202 ^
  --gpu-sensors-disable ^
  --disable-worker-watchdog ^
  --log-file "%LOG%"

REM Fallbacks, if xelishash ever stops paying or a pool host dies:
REM   --algorithm autolykos2 --pool stratum+tcp://autolykos.unmineable.com:3333   (~2.2 GB per card)
REM   --algorithm karlsenhash --pool stratum+tcp://karlsenhash.unmineable.com:3333 (small DAG)
pause
