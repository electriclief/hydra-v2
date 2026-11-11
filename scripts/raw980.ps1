$ErrorActionPreference = 'Continue'
'== raw api json (so the parse stops lying to me)'
try {
  $r = Invoke-WebRequest 'http://127.0.0.1:61235/' -TimeoutSec 8
  $j = $r.Content
  '  length {0}' -f $j.Length
  '  ' + $j.Substring(0, [Math]::Min(600, $j.Length))
} catch { '  api error: ' + $_.Exception.Message }
'== miner processes'
$lol = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)lolminer' })
'  lolMiner count: ' + $lol.Count
$lol | ForEach-Object { '    pid {0} started {1}' -f $_.ProcessId, $_.CreationDate }
'== the watch window, which parses this api correctly'
Get-Content 'C:\AI\logs\watch.log' -Tail 8 | ForEach-Object { '  ' + $_ }
'== guard'
Get-Content 'C:\AI\hydra-local\data\standby\guard.log' -Tail 6 | ForEach-Object { '  ' + $_ }
$s = Get-Content 'C:\AI\hydra-local\data\standby\guard.state.json' -Raw | ConvertFrom-Json
'  mode {0}  miner {1}  pinned {2}  grace {3}' -f $s.mode, $s.miner, $s.pinned, $s.grace
'== power now'
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=utilization.gpu,power.draw,memory.used --format=csv,noheader
'RAW DONE'
