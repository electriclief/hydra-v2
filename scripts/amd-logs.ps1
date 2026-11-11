$ErrorActionPreference = 'Continue'
foreach ($a in 'ETCHASH', 'AUTOLYKOS2') {
  $p = "C:\AI\logs\amd-$a.txt"
  '=== ' + $a + '  ->  ' + $p
  if (-not (Test-Path $p)) { '  (missing)'; continue }
  $l = Get-Content $p
  '  lines: ' + $l.Count
  $l | Where-Object { $_ -match '(?i)selected|device \d|dag|memory|allocat|not supported|error|warn|etchash|autolykos' } | Select-Object -First 14 | ForEach-Object { '  ' + ($_ -replace '\s+', ' ').Trim() }
}
'=== mining now'
try { $r = Invoke-RestMethod 'http://127.0.0.1:60220/' -TimeoutSec 8; $alg = @($r.algorithms)[0]; '  {0} H/s  A{1} R{2}' -f $alg.hashrate.'15min', $alg.shares.accepted, $alg.shares.rejected } catch { '  api: ' + $_.Exception.Message }
'AMDLOGS DONE'
