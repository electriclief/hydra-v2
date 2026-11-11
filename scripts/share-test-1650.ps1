# Five minutes of real mining on the newest working build: the question is not "does it report a rate" but "does the pool
# accept shares". SRBMiner 3.8.0 is the build that hashes on this Turing card; 3.8.6 dies with a GPU recovery error.
$ErrorActionPreference = 'Continue'
$exe = 'C:\AI\miners\srb380\SRBMiner-MULTI.exe'
$log = 'C:\AI\logs\share-test-1650.txt'
Remove-Item $log -Force -ErrorAction SilentlyContinue
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=name,driver_version --format=csv,noheader
$p = Start-Process -FilePath $exe -WorkingDirectory 'C:\AI\miners\srb380' -PassThru -WindowStyle Hidden -ArgumentList @(
  '--algorithm', 'xelishashv3', '--pool', 'stratum+tcp://xelishash.unmineable.com:3333',
  '--wallet', 'leafdriving2.unmineable_miner_miner1', '--disable-cpu',
  '--api-enable', '--api-port', '60210', '--gpu-sensors-disable', '--log-file', $log
)
$best = 0
for ($i = 0; $i -lt 10; $i++) {
  Start-Sleep -Seconds 30
  try {
    $a = Invoke-RestMethod 'http://127.0.0.1:60210/' -TimeoutSec 6
    $alg = @($a.algorithms)[0]
    $r = [double]$alg.hashrate.'15min'
    if ($r -gt $best) { $best = $r }
    '{0}  rate {1:N2} H/s   accepted {2}   rejected {3}' -f (Get-Date).ToString('HH:mm:ss'), $r, $alg.shares.accepted, $alg.shares.rejected
  } catch { '{0}  api: {1}' -f (Get-Date).ToString('HH:mm:ss'), $_.Exception.Message }
}

'--- gpu totals'
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=utilization.gpu,memory.used,temperature.gpu,power.draw,clocks.sm,pcie.link.gen.current,pcie.link.width.current --format=csv,noheader
'--- accepted share lines from the miner log'
if (Test-Path $log) {
  $acc = @(Get-Content $log | Where-Object { $_ -match '(?i)accepted|share' })
  '  share lines: {0}' -f $acc.Count
  $acc | Select-Object -Last 6 | ForEach-Object { '  ' + $_ }
}
try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { }
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
'SHARE-TEST DONE'
