# Both cards hash when the init OOM is survived - prove it with accepted shares, not a printed rate.
# 5 minutes, API polled every 30 s, per-GPU rate and pool acceptance recorded to a log.
$ErrorActionPreference = 'Continue'
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
$log = 'C:\AI\logs\twocard-5min.txt'
$rep = 'C:\AI\reports\miner1-twocard.txt'
Remove-Item $log -Force -ErrorAction SilentlyContinue
Remove-Item $rep -Force -ErrorAction SilentlyContinue
$p = Start-Process -FilePath 'C:\AI\miners\srb380\SRBMiner-MULTI.exe' -WorkingDirectory 'C:\AI\miners\srb380' -PassThru -WindowStyle Hidden -ArgumentList @(
  '--algorithm', 'xelishashv3', '--pool', 'stratum+tcp://xelishash.unmineable.com:3333',
  '--wallet', 'leafdriving2.unmineable_miner_miner1', '--disable-cpu',
  '--api-enable', '--api-port', '60219', '--gpu-sensors-disable', '--log-file', $log
)
"two-card run started $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))" | Out-File $rep -Encoding UTF8
$oom = 0
for ($i = 1; $i -le 10; $i++) {
  Start-Sleep -Seconds 30
  try {
    $a = Invoke-RestMethod 'http://127.0.0.1:60219/' -TimeoutSec 8
    $alg = @($a.algorithms)[0]
    $gpus = @($a.gpus)
    $line = '  t{0,3}s  total {1,8} H/s  accepted {2}  rejected {3}  hw {4}' -f ($i * 30), $alg.hashrate.'15min', $alg.shares.accepted, $alg.shares.rejected, $alg.shares.hw_invalid
    $line | Tee-Object -FilePath $rep -Append
    foreach ($g in $gpus) { ('    gpu{0}  {1,8} H/s  {2} C  {3} MB' -f $g.device_id, $g.hashrate.'15min', $g.temp, $g.memory_usage.total) | Tee-Object -FilePath $rep -Append }
  } catch { ('  t{0,3}s  api: {1}' -f ($i * 30), $_.Exception.Message) | Tee-Object -FilePath $rep -Append }
}
if (Test-Path $log) {
  $oom = @(Get-Content $log | Where-Object { $_ -match 'OUT_OF_MEMORY' }).Count
  "  OOM lines in miner log: $oom" | Tee-Object -FilePath $rep -Append
  '  --- share lines' | Tee-Object -FilePath $rep -Append
  Get-Content $log | Where-Object { $_ -match '(?i)accepted|rejected' } | Select-Object -Last 6 | ForEach-Object { '  ' + $_ } | Tee-Object -FilePath $rep -Append
}
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=index,name,utilization.gpu,memory.used,temperature.gpu,power.draw --format=csv,noheader | Tee-Object -FilePath $rep -Append
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
'TWOCARD DONE'
