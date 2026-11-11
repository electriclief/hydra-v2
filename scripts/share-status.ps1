# Where the 5-minute share run stands: process alive, API numbers, and the log's share lines.
$ErrorActionPreference = 'Continue'
$p = @(Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue)
'miner running : {0}' -f ($p.Count -gt 0)
foreach ($x in $p) { '  pid {0}  cpu {1:N0} s' -f $x.Id, $x.CPU }
try {
  $a = Invoke-RestMethod 'http://127.0.0.1:60210/' -TimeoutSec 6
  $g = @($a.algorithms)[0]
  'rate 15min    : {0}' -f $g.hashrate.'15min'
  'accepted      : {0}' -f $g.shares.accepted
  'rejected      : {0}' -f $g.shares.rejected
} catch { 'api           : ' + $_.Exception.Message }
$log = 'C:\AI\logs\share-test-1650.txt'
if (Test-Path $log) {
  'log size      : {0} KB' -f [math]::Round((Get-Item $log).Length / 1KB, 1)
  Get-Content $log | Where-Object { $_ -match '(?i)accepted|H/s' } | Select-Object -Last 6 | ForEach-Object { '  ' + $_ }
} else { 'no log at ' + $log }
if (Test-Path 'C:\Windows\System32\nvidia-smi.exe') {
  & 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=utilization.gpu,memory.used,temperature.gpu,power.draw,clocks.sm --format=csv,noheader
}
