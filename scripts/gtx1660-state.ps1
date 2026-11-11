$ErrorActionPreference = 'Continue'
'== doors now'
$want = 8125,8126,8127,8128,8129,8130,8131,8133,8136,8137
foreach ($p in $want) {
  $c = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { '  {0} UP pid {1}' -f $p, $c.OwningProcess } else { '  {0} ---' -f $p }
}
'== processes'
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object { $cl = ($_.CommandLine -replace '\s+',' '); '  pid {0} {1}' -f $_.ProcessId, $cl.Substring(0,[Math]::Min(75,$cl.Length)) }
'== pw rows (if the wrapper is up)'
try { $r = Invoke-RestMethod 'http://127.0.0.1:8125/api/processes' -TimeoutSec 8; '  rows: ' + @($r.processes).Count; @($r.processes) | ForEach-Object { '   {0,-22} {1}' -f $_.name, $_.life } } catch { '  pw not answering' }
'== shelf log'
if (Test-Path 'C:\AI\hydra-local\logs\shelf-try.out') { Get-Content 'C:\AI\hydra-local\logs\shelf-try.out' -Tail 12 | ForEach-Object { '  | ' + ($_ -replace '\s+',' ').Trim() } }
if (Test-Path 'C:\AI\hydra-local\logs\shelf.log') { '  --- shelf.log'; Get-Content 'C:\AI\hydra-local\logs\shelf.log' -Tail 12 | ForEach-Object { '  | ' + ($_ -replace '\s+',' ').Trim() } }
'1660 STATE DONE'
