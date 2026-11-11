# Clean numbers. The previous solo llama figures were taken while a stray SRBMiner (pid 3588) was still hashing, so they
# are not trustworthy. Nothing else runs this time. Then: does SRBMiner's OOM on the 1050 Ti respond to a lower intensity?
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Get-Process SRBMiner-MULTI, llama-bench, llama-cli -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 5
'idle check: {0} miner processes' -f (@(Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue).Count)

function Bench($extra, $label) {
  Section $label
  $out = "C:\AI\logs\clean-$label.txt"
  Remove-Item $out -Force -ErrorAction SilentlyContinue
  $args = @('-m', 'C:\AI\models\qwen2.5-0.5b-q4km.gguf', '-p', '256', '-n', '64', '-ngl', '99', '-r', '1') + $extra
  & 'C:\AI\llama\llama-bench.exe' @args 2>&1 | Out-File -FilePath $out -Encoding UTF8
  Get-Content $out | Where-Object { $_ -match 'pp256|tg64' } | ForEach-Object {
    $c = ($_ -split '\|') | ForEach-Object { $_.Trim() }
    if ($c.Count -ge 8) { '  {0,-6} {1}' -f $c[$c.Count - 3], $c[$c.Count - 2] }
  }
}

Bench @('-dev', 'Vulkan0') '1650'
Bench @('-dev', 'Vulkan1') '1050Ti'
Bench @('-sm', 'layer') 'pooled'

Section 'SRBMiner flags that touch memory'
(& 'C:\AI\miners\srb380\SRBMiner-MULTI.exe' --help 2>&1 | Where-Object { $_ -match '(?i)intensity|worksize|memory|thread' } | Select-Object -First 14) |
  ForEach-Object { '  ' + $_ }

Section '3.8.0 on the 1050 Ti with a lower intensity (60 s)'
$log = 'C:\AI\logs\solo1050-lowint.txt'
Remove-Item $log -Force -ErrorAction SilentlyContinue
$p = Start-Process -FilePath 'C:\AI\miners\srb380\SRBMiner-MULTI.exe' -WorkingDirectory 'C:\AI\miners\srb380' -PassThru -WindowStyle Hidden -ArgumentList @(
  '--algorithm', 'xelishashv3', '--pool', 'stratum+tcp://xelishash.unmineable.com:3333',
  '--wallet', 'leafdriving2.unmineable_miner_miner1', '--disable-cpu', '--gpu-id', '1',
  '--intensity', '12', '--api-enable', '--api-port', '60215', '--gpu-sensors-disable', '--log-file', $log
)
Start-Sleep -Seconds 60
try {
  $a = Invoke-RestMethod 'http://127.0.0.1:60215/' -TimeoutSec 8
  $alg = @($a.algorithms)[0]
  '  rate {0} H/s  accepted {1}' -f $alg.hashrate.'15min', $alg.shares.accepted
} catch { '  api: ' + $_.Exception.Message }
try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { }
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
if (Test-Path $log) { Get-Content $log | Where-Object { $_ -match '(?i)h/s|error|cuda|intensity|program' } | Select-Object -Last 5 | ForEach-Object { '  ' + $_ } }
'CLEAN DONE'
