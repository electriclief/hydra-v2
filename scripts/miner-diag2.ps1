# Two ways to get a hashrate out of this card without touching the driver:
#   1. does SRBMiner have an OpenCL-backend switch (OpenCL works on 472.80; the CUDA kernel image does not)
#   2. does a different algorithm hash through CUDA at all (autolykos2) - proves the card can, or proves it cannot
$ErrorActionPreference = 'Continue'
$srb = 'C:\AI\miners\srbminer\SRBMiner-MULTI.exe'
$dir = 'C:\AI\miners\srbminer'

'=== backend switches in this build'
$h = & $srb --help 2>&1
($h | Where-Object { $_ -match '(?i)backend|opencl|cuda' } | Select-Object -First 12) | ForEach-Object { '  ' + $_ }

function Run-Miner($algo, $seconds, $port, $extra, $label) {
  '' ; '=== ' + $label
  $log = "C:\AI\logs\probe-$label.txt"
  Remove-Item $log -Force -ErrorAction SilentlyContinue
  $args = @('--algorithm', $algo, '--pool', 'stratum+tcp://xelishash.unmineable.com:3333',
    '--wallet', 'leafdriving2.unmineable_miner_miner1', '--disable-cpu',
    '--api-enable', '--api-port', "$port", '--gpu-sensors-disable', '--log-file', $log) + $extra
  if ($algo -eq 'autolykos2') {
    $args = @('--algorithm', 'autolykos2', '--pool', 'stratum+tcp://autolykos.unmineable.com:3333',
      '--wallet', 'leafdriving2.unmineable_miner_miner1', '--disable-cpu',
      '--api-enable', '--api-port', "$port", '--gpu-sensors-disable', '--log-file', $log) + $extra
  }
  $p = Start-Process -FilePath $srb -WorkingDirectory $dir -PassThru -WindowStyle Hidden -ArgumentList $args
  Start-Sleep -Seconds $seconds
  try {
    $a = Invoke-RestMethod ("http://127.0.0.1:$port/") -TimeoutSec 6
    $alg = @($a.algorithms) | Select-Object -First 1
    '  api   : {0}  rate(15m) {1}  accepted {2}  rejected {3}' -f $alg.name, $alg.hashrate.'15min', $alg.shares.accepted, $alg.shares.rejected
  } catch { '  api   : ' + $_.Exception.Message }
  try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { }
  Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  if (Test-Path $log) {
    Get-Content $log | Where-Object { $_ -match '(?i)h/s|error|init|couldn|cuda|kernel|accepted' } |
      Select-Object -Last 8 | ForEach-Object { '  ' + $_ }
  }
  Start-Sleep -Seconds 3
}

Run-Miner 'xelishashv3' 75 60204 @('--gpu-backend', 'opencl') 'xelis-opencl'
Run-Miner 'autolykos2' 75 60205 @() 'autolykos2-cuda'
'MINER-DIAG2 DONE'
