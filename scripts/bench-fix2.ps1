# Two open questions, one pass each.
# 1) A real pooled llama.cpp number needs -sm layer; without it llama-bench just benchmarks each device separately.
# 2) SRBMiner 3.8.0 OOMs on the 1050 Ti alone (cuMemAlloc CUDA_ERROR_OUT_OF_MEMORY) while 3.8.0 hashes fine on the 1650.
#    jims' 2 GB GTX 1050 runs this algo in 1,375 MiB, so memory is not the real limit - test the other build on that card.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Get-Process SRBMiner-MULTI, llama-bench -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Section 'pooled llama.cpp, split mode layer'
$out = 'C:\AI\logs\pooled-layer.txt'
Remove-Item $out -Force -ErrorAction SilentlyContinue
& 'C:\AI\llama\llama-bench.exe' -m 'C:\AI\models\qwen2.5-0.5b-q4km.gguf' -p 256 -n 64 -ngl 99 -sm layer -r 1 2>&1 |
  Out-File -FilePath $out -Encoding UTF8
Get-Content $out | Where-Object { $_ -match '^\||error|fail' } | ForEach-Object { '  ' + $_ }

Section 'SRBMiner 3.8.6 on the 1050 Ti alone (60 s)'
$log = 'C:\AI\logs\solo1050-386.txt'
Remove-Item $log -Force -ErrorAction SilentlyContinue
$p = Start-Process -FilePath 'C:\AI\miners\srbminer\SRBMiner-MULTI.exe' -WorkingDirectory 'C:\AI\miners\srbminer' -PassThru -WindowStyle Hidden -ArgumentList @(
  '--algorithm', 'xelishashv3', '--pool', 'stratum+tcp://xelishash.unmineable.com:3333',
  '--wallet', 'leafdriving2.unmineable_miner_miner1', '--disable-cpu', '--gpu-id', '1',
  '--api-enable', '--api-port', '60214', '--gpu-sensors-disable', '--log-file', $log
)
Start-Sleep -Seconds 60
try {
  $a = Invoke-RestMethod 'http://127.0.0.1:60214/' -TimeoutSec 8
  $alg = @($a.algorithms)[0]
  '  rate {0} H/s  accepted {1}  rejected {2}' -f $alg.hashrate.'15min', $alg.shares.accepted, $alg.shares.rejected
} catch { '  api: ' + $_.Exception.Message }
try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { }
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
if (Test-Path $log) { Get-Content $log | Where-Object { $_ -match '(?i)h/s|error|recovery|cuda|program' } | Select-Object -Last 6 | ForEach-Object { '  ' + $_ } }

Section 'memory each card reports while idle'
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=index,name,memory.total,memory.used,memory.free --format=csv
'FIX2 DONE'
