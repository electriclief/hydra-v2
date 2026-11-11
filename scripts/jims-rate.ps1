# What jims' 2 GB card is actually doing - the number that decides whether 2 GB is our floor.
$ErrorActionPreference = 'Continue'
'host: {0}' -f $env:COMPUTERNAME
& nvidia-smi --query-gpu=name,memory.total,memory.used,utilization.gpu,temperature.gpu,power.draw --format=csv,noheader

$port = 60201
try {
  $j = Invoke-RestMethod ("http://127.0.0.1:" + $port + "/") -TimeoutSec 6
  $a = @($j.algorithms) | Select-Object -First 1
  if ($a) {
    'algo      : {0}' -f $a.name
    'rate 1min : {0:N2} MH/s' -f ([double]$a.hashrate.'1min' / 1e6)
    'rate 15min: {0:N2} MH/s' -f ([double]$a.hashrate.'15min' / 1e6)
    'accepted  : {0}   rejected: {1}' -f $a.shares.accepted, $a.shares.rejected
    'pool      : {0}' -f $a.pool.pool
    'wallet    : {0}' -f $a.pool.wallet
    if ($j.mining_time) { 'uptime    : {0:N1} h' -f ($j.mining_time / 3600) }
  }
} catch { 'api not answering: ' + $_.Exception.Message }

'--- log tail (the DAG / memory lines are the interesting ones)'
$log = 'C:\AI\miners\logs\gpu.log'
if (Test-Path $log) {
  Get-Content $log -Tail 400 |
    Where-Object { $_ -match '(?i)algorithm|speed|accepted|share|memory|dag|error' } |
    Select-Object -Last 12 | ForEach-Object { '  ' + $_ }
} else { '  no log at ' + $log }
