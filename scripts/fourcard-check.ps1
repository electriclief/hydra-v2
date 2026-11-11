$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '== ' + $t }
Section 'miner processes'
Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)srb|lol' } | ForEach-Object {
  '  pid {0} :: {1}' -f $_.ProcessId, (($_.CommandLine -replace '\s+', ' '))
}
Section 'xelis instance: per-GPU lines (is GPU0 the 580 hashing?)'
$l = 'C:\AI\logs\miner-auto.txt'
if (Test-Path $l) { Get-Content $l | Where-Object { $_ -match 'GPU\d' } | Select-Object -Last 10 | ForEach-Object { '  ' + ($_ -replace '\s+', ' ').Trim() } }
Section 'xelis instance api'
try { $a = Invoke-RestMethod 'http://127.0.0.1:60220/' -TimeoutSec 8; $alg = @($a.algorithms)[0]; '  {0:N0} H/s  A{1} R{2}' -f $alg.hashrate.'15min', $alg.shares.accepted, $alg.shares.rejected } catch { '  api: ' + $_.Exception.Message }
Section 'etchash instance api (60221)'
try { $a = Invoke-RestMethod 'http://127.0.0.1:60221/' -TimeoutSec 8; $alg = @($a.algorithms)[0]; '  {0:N0} H/s  A{1} R{2}' -f $alg.hashrate.'15min', $alg.shares.accepted, $alg.shares.rejected } catch { '  api: ' + $_.Exception.Message }
Section 'any errors mentioning the AMD card'
foreach ($f in 'C:\AI\logs\miner-auto.txt', 'C:\AI\logs\amd-etchash.txt') {
  if (Test-Path $f) {
    '  --- ' + $f
    Get-Content $f | Where-Object { $_ -match '(?i)amd|opencl|ellesmere|not supported|error' } | Select-Object -Last 6 | ForEach-Object { '    ' + ($_ -replace '\s+', ' ').Trim() }
  }
}
'FOURCARD CHECK DONE'
