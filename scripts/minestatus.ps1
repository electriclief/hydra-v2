$ErrorActionPreference = 'Continue'
'=== live API on 60220'
try {
  $a = Invoke-RestMethod 'http://127.0.0.1:60220/' -TimeoutSec 10
  $alg = @($a.algorithms)[0]
  '  rate     : {0} H/s' -f $alg.hashrate.'15min'
  '  accepted : {0}' -f $alg.shares.accepted
  '  rejected : {0}' -f $alg.shares.rejected
  '  algo     : {0}' -f $alg.name
  '  pool     : {0}' -f $alg.pool.pool
  '  uptime   : {0}' -f $a.uptime
} catch { '  api not answering: ' + $_.Exception.Message }
'=== recent miner log lines (per GPU)'
$l = 'C:\AI\logs\miner-auto.txt'
if (Test-Path $l) { Get-Content $l | Where-Object { $_ -match 'GPU\d|accepted' } | Select-Object -Last 8 | ForEach-Object { '  ' + $_ } }
'=== supervisor trail'
$w = 'C:\AI\logs\supervisor.txt'
if (Test-Path $w) { Get-Content $w -Tail 8 | ForEach-Object { '  ' + $_ } }
'=== session check'
Get-CimInstance Win32_Process -Filter "Name='SRBMiner-MULTI.exe'" | ForEach-Object { '  SRBMiner pid {0} session {1}' -f $_.ProcessId, $_.SessionId }
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=index,name,utilization.gpu,memory.used,temperature.gpu,power.draw --format=csv,noheader
'STATUS DONE'
