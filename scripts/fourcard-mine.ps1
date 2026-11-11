# First four-card mining run: AMD on OpenCL, three NVIDIA on CUDA, one SRBMiner instance.
$ErrorActionPreference = 'Continue'
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 4
$log = 'C:\AI\logs\fourcard-mine.txt'
Remove-Item $log -Force -ErrorAction SilentlyContinue
$p = Start-Process -FilePath 'C:\AI\miners\srb380\SRBMiner-MULTI.exe' -WorkingDirectory 'C:\AI\miners\srb380' -PassThru -WindowStyle Hidden -ArgumentList @(
  '--algorithm', 'xelishashv3', '--pool', 'stratum+tcp://xelishash.unmineable.com:3333',
  '--wallet', 'leafdriving2.unmineable_miner_miner1', '--disable-cpu',
  '--api-enable', '--api-port', '60221', '--gpu-sensors-disable', '--log-file', $log
)
for ($i = 1; $i -le 4; $i++) {
  Start-Sleep -Seconds 45
  try {
    $a = Invoke-RestMethod 'http://127.0.0.1:60221/' -TimeoutSec 8
    $alg = @($a.algorithms)[0]
    '  t{0,3}s  total {1,8} H/s  accepted {2}  rejected {3}' -f ($i * 45), $alg.hashrate.'15min', $alg.shares.accepted, $alg.shares.rejected
  } catch { '  t{0,3}s  api: {1}' -f ($i * 45), $_.Exception.Message }
}
'--- per GPU from the miner log'
if (Test-Path $log) { Get-Content $log | Where-Object { $_ -match 'GPU\d' } | Select-Object -Last 6 | ForEach-Object { '  ' + $_ } }
'--- ukraine (errors)'
if (Test-Path $log) { Get-Content $log | Where-Object { $_ -match '(?i)error|fail|recovery' } | Select-Object -Last 4 | ForEach-Object { '  ' + $_ } }
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
'FOURCARD DONE'
