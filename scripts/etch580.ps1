# The 580 is bound and SRBMiner sees radeon_rx_580_series [ellesmere] [8192 MB] [CU: 36] [MaxBuf: 6745 MB].
# The question is whether a 4,447 MB etchash DAG will allocate on a host with 1.3 GB of free RAM, and what it earns.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$log = 'C:\AI\logs\amd-etchash.txt'
Remove-Item $log -Force -ErrorAction SilentlyContinue

Section 'start etchash on the RX 580 only (NVIDIA keeps its xelis instance)'
$p = Start-Process -FilePath 'C:\AI\miners\srb380\SRBMiner-MULTI.exe' -WorkingDirectory 'C:\AI\miners\srb380' -PassThru -NoNewWindow -ArgumentList @(
  '--algorithm', 'etchash', '--pool', 'stratum+tcp://etchash.unmineable.com:3333',
  '--wallet', 'leafdriving2.unmineable_miner_miner1',
  '--gpu-id', '0', '--disable-gpu-nvidia', '--disable-cpu',
  '--api-enable', '--api-port', '60221', '--gpu-sensors-disable', '--log-file', $log
)
'  pid ' + $p.Id

for ($i = 1; $i -le 6; $i++) {
  Start-Sleep -Seconds 50
  try {
    $a = Invoke-RestMethod 'http://127.0.0.1:60221/' -TimeoutSec 8
    $alg = @($a.algorithms)[0]
    '  t{0,4}s  {1,10} H/s   A{2} R{3}' -f ($i * 50), $alg.hashrate.'15min', $alg.shares.accepted, $alg.shares.rejected
  } catch { '  t{0,4}s  api: {1}' -f ($i * 50), $_.Exception.Message }
}

Section 'log highlights'
if (Test-Path $log) {
  $l = Get-Content $log
  $l | Where-Object { $_ -match '(?i)memory|dag|error|fail|GPU0|accepted|authorized|new job' } | Select-Object -First 12 | ForEach-Object { '  ' + ($_ -replace '\s+', ' ').Trim() }
  '  --- last 6'
  $l | Select-Object -Last 6 | ForEach-Object { '  ' + ($_ -replace '\s+', ' ').Trim() }
}

Section 'stop the etchash instance'
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Where-Object { $_.Id -eq $p.Id } | Stop-Process -Force -ErrorAction SilentlyContinue
'ETCH580 DONE'
