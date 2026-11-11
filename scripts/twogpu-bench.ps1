# Two-card bench on one driver: each card alone, then both pooled into one llama.cpp model, then a rig-wide mining run.
# The pooled number matters more than the two solo numbers - capacity across x1 links is the thing being paid for.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$lb = 'C:\AI\llama\llama-bench.exe'
$model = 'C:\AI\models\qwen2.5-0.5b-q4km.gguf'
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

function Bench($dev, $label) {
  $out = "C:\AI\logs\bench-$label.txt"
  Remove-Item $out -Force -ErrorAction SilentlyContinue
  & $lb -m $model -p 256 -n 64 -ngl 99 -dev $dev -r 1 2>&1 | Out-File -FilePath $out -Encoding UTF8
  $rows = Get-Content $out | Where-Object { $_ -match 'pp256|tg64' }
  foreach ($line in $rows) {
    $f = ($line -split '\|') | ForEach-Object { $_.Trim() }
    if ($f.Count -ge 8) { '  {0,-12} {1,-6} {2} t/s' -f $label, $f[6], $f[7] }
  }
}

Section 'each card alone'
Bench 'Vulkan0' '1650'
Bench 'Vulkan1' '1050Ti'

Section 'both pooled (-sm layer)'
Bench 'Vulkan0,Vulkan1' 'pooled'

Section 'mining, both cards, 120 s'
$srb = 'C:\AI\miners\srb380\SRBMiner-MULTI.exe'
$log = 'C:\AI\logs\twogpu-mine.txt'
Remove-Item $log -Force -ErrorAction SilentlyContinue
$p = Start-Process -FilePath $srb -WorkingDirectory 'C:\AI\miners\srb380' -PassThru -WindowStyle Hidden -ArgumentList @(
  '--algorithm', 'xelishashv3', '--pool', 'stratum+tcp://xelishash.unmineable.com:3333',
  '--wallet', 'leafdriving2.unmineable_miner_miner1', '--disable-cpu',
  '--api-enable', '--api-port', '60211', '--gpu-sensors-disable', '--log-file', $log
)
Start-Sleep -Seconds 120
try {
  $a = Invoke-RestMethod 'http://127.0.0.1:60211/' -TimeoutSec 8
  $alg = @($a.algorithms)[0]
  '  total rate : {0} H/s' -f $alg.hashrate.'15min'
  '  shares     : accepted {0}  rejected {1}' -f $alg.shares.accepted, $alg.shares.rejected
} catch { '  api: ' + $_.Exception.Message }
'  --- per card from the log'
if (Test-Path $log) { Get-Content $log | Where-Object { $_ -match 'GPU\d' } | Select-Object -Last 4 | ForEach-Object { '  ' + $_ } }
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=index,name,utilization.gpu,memory.used,temperature.gpu,power.draw --format=csv,noheader
try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { }
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
'TWOGPU-BENCH DONE'
