$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
'host: ' + $env:COMPUTERNAME
Section 'console sessions'
& query session 2>&1 | ForEach-Object { '  ' + $_ }
Section 'who is logged on'
& quser 2>&1 | ForEach-Object { '  ' + $_ }
Section 'miners on disk'
foreach ($d in 'C:\AI\miners', 'C:\AI\tools', 'C:\AI') {
  if (Test-Path $d) {
    '  --- ' + $d
    Get-ChildItem $d -Directory -ErrorAction SilentlyContinue | Select-Object -First 12 | ForEach-Object { '      ' + $_.Name }
  }
}
Section 'miner-like executables found'
@('SRBMiner-MULTI.exe', 'lolMiner.exe', 'xmrig.exe') | ForEach-Object {
  $n = $_
  Get-ChildItem 'C:\AI' -Recurse -Filter $n -ErrorAction SilentlyContinue | Select-Object -First 3 | ForEach-Object { '  {0}  ({1:N0} bytes)' -f $_.FullName, $_.Length }
}
Section 'anything mining right now'
Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)srb|lol|xmrig' } | ForEach-Object { '  pid {0} session {1} :: {2}' -f $_.ProcessId, $_.SessionId, ($_.CommandLine -replace '\s+', ' ') }
Section 'gpu'
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=index,name,driver_version,memory.used,utilization.gpu --format=csv,noheader
Section 'scheduled tasks that look like mining'
Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -match '(?i)mine|hydra' } | ForEach-Object { '  {0} [{1}]' -f $_.TaskName, $_.State }
Section 'old logs that name the pool/wallet'
Get-ChildItem 'C:\AI\logs' -Filter '*.txt' -ErrorAction SilentlyContinue | Select-Object -First 10 | ForEach-Object { '  ' + $_.Name }
'GVTX PROBE DONE'
