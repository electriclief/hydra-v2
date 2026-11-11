# 120 seconds of xelishashv3 on the new driver: the only question is whether GPU0 creates the program and reports a rate.
$ErrorActionPreference = 'Continue'
$srb = 'C:\AI\miners\srbminer\SRBMiner-MULTI.exe'
$log = 'C:\AI\logs\xelis-591.txt'
Remove-Item $log -Force -ErrorAction SilentlyContinue
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

'=== driver'
if (Test-Path 'C:\Windows\System32\nvidia-smi.exe') { & 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=name,driver_version,memory.total --format=csv,noheader }

'=== mining 120 s'
$p = Start-Process -FilePath $srb -WorkingDirectory 'C:\AI\miners\srbminer' -PassThru -WindowStyle Hidden -ArgumentList @(
  '--algorithm', 'xelishashv3', '--pool', 'stratum+tcp://xelishash.unmineable.com:3333',
  '--wallet', 'leafdriving2.unmineable_miner_miner1', '--disable-cpu',
  '--api-enable', '--api-port', '60207', '--gpu-sensors-disable', '--log-file', $log
)
Start-Sleep -Seconds 120
try {
  $a = Invoke-RestMethod 'http://127.0.0.1:60207/' -TimeoutSec 8
  $alg = @($a.algorithms) | Select-Object -First 1
  'RATE       : {0} H/s  (1m {1} / 15m {2})' -f $alg.hashrate.'15min', $alg.hashrate.'1min', $alg.hashrate.'15min'
  'SHARES     : accepted {0}  rejected {1}' -f $alg.shares.accepted, $alg.shares.rejected
  'POOL       : {0}' -f $alg.pool.pool
} catch { 'API        : ' + $_.Exception.Message }

'=== gpu after'
if (Test-Path 'C:\Windows\System32\nvidia-smi.exe') {
  & 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=utilization.gpu,memory.used,temperature.gpu,power.draw,clocks.sm,pcie.link.gen.current,pcie.link.width.current --format=csv,noheader
}
try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { }
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
'=== log, the lines that matter'
if (Test-Path $log) { Get-Content $log | Where-Object { $_ -match '(?i)h/s|error|cuda|kernel|program|init|share' } | Select-Object -Last 12 | ForEach-Object { '  ' + $_ } }
'XELIS-591 DONE'
