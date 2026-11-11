$ErrorActionPreference = 'Continue'
foreach ($a in 'ETCHASH', 'AUTOLYKOS2') {
  $p = "C:\AI\logs\amd-$a.txt"
  '=== ' + $a + '  (tail)'
  if (Test-Path $p) { Get-Content $p | Select-Object -Last 18 | ForEach-Object { '  ' + ($_ -replace '\s+', ' ').Trim() } } else { '  (missing)' }
}
'=== task / miner state'
$t = Get-ScheduledTask -TaskName 'HydraMine1' -ErrorAction SilentlyContinue
if ($t) { '  HydraMine1: ' + $t.State } else { '  HydraMine1 missing' }
Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)srb|lol' } | ForEach-Object { '  pid {0} session {1} {2}' -f $_.ProcessId, $_.SessionId, $_.Name }
'=== supervisor trail'
if (Test-Path 'C:\AI\logs\supervisor.txt') { Get-Content 'C:\AI\logs\supervisor.txt' -Encoding UTF8 | Select-Object -Last 6 | ForEach-Object { '  ' + $_ } }
'TAIL DONE'
