# Two things to pin down: the exact llama-bench rows (my parser mis-sliced the table), and why SRBMiner reports 0.00 H/s
# on both cards when one share was accepted. Isolate each GPU alone - a combined run can fail on one architecture and
# still look alive.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Get-Process SRBMiner-MULTI, llama-bench -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Section 'llama-bench rows, raw'
foreach ($f in 'C:\AI\logs\bench-1650.txt', 'C:\AI\logs\bench-1050Ti.txt', 'C:\AI\logs\bench-pooled.txt') {
  '--- ' + (Split-Path $f -Leaf)
  if (Test-Path $f) { Get-Content $f | Where-Object { $_ -match '^\|' } | ForEach-Object { '  ' + $_ } }
}

Section 'what the combined mining run complained about'
$m = 'C:\AI\logs\twogpu-mine.txt'
if (Test-Path $m) {
  Get-Content $m | Where-Object { $_ -match '(?i)error|fail|cuda|kernel|program|init|warn' } | Select-Object -First 15 | ForEach-Object { '  ' + $_ }
}

function SoloGPU($id, $port, $label) {
  Section "$label alone (60 s)"
  $log = "C:\AI\logs\solo-$label.txt"
  Remove-Item $log -Force -ErrorAction SilentlyContinue
  $p = Start-Process -FilePath 'C:\AI\miners\srb380\SRBMiner-MULTI.exe' -WorkingDirectory 'C:\AI\miners\srb380' -PassThru -WindowStyle Hidden -ArgumentList @(
    '--algorithm', 'xelishashv3', '--pool', 'stratum+tcp://xelishash.unmineable.com:3333',
    '--wallet', 'leafdriving2.unmineable_miner_miner1', '--disable-cpu', '--gpu-id', "$id",
    '--api-enable', '--api-port', "$port", '--gpu-sensors-disable', '--log-file', $log
  )
  Start-Sleep -Seconds 60
  try {
    $a = Invoke-RestMethod ("http://127.0.0.1:$port/") -TimeoutSec 8
    $alg = @($a.algorithms)[0]
    '  rate {0} H/s   accepted {1}   rejected {2}' -f $alg.hashrate.'15min', $alg.shares.accepted, $alg.shares.rejected
  } catch { '  api: ' + $_.Exception.Message }
  try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { }
  Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  if (Test-Path $log) { Get-Content $log | Where-Object { $_ -match '(?i)h/s|error|cuda|program|init' } | Select-Object -Last 5 | ForEach-Object { '  ' + $_ } }
  Start-Sleep -Seconds 3
}

SoloGPU 0 60212 'gpu0'
SoloGPU 1 60213 'gpu1'
'BENCHFIX DONE'
