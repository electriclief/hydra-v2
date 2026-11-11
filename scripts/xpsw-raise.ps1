$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section 'raise it detached (a child of this ssh session would die with the session)'
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = 'cmd.exe /c "C:\AI\hydra-local\scripts\relaunch-xpsw.cmd"' }
'  returnValue=' + $r.ReturnValue + '  pid=' + $r.ProcessId
Section 'wait for the doors'
$want = 8125,8127,8128,8129,8130,8131,8133,8136,8137
for ($i = 1; $i -le 18; $i++) {
  Start-Sleep -Seconds 5
  $up = @()
  foreach ($p in $want) { if (Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue) { $up += $p } }
  '  t{0,3}s  doors up: {1}/{2}  ({3})' -f ($i*5), $up.Count, $want.Count, ($up -join ',')
  if ($up.Count -ge 7) { break }
}
Section 'final state'
foreach ($p in $want) {
  $c = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { '  {0,-5} UP  pid {1,-6} {2}' -f $p, $c.OwningProcess, $c.LocalAddress } else { '  {0,-5} ---' -f $p }
}
Section 'processes'
Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)node|electron' } | ForEach-Object {
  $cl = ($_.CommandLine -replace '\s+',' ')
  '  {0,-12} pid {1,-6} session {2,-3} {3}' -f $_.Name, $_.ProcessId, $_.SessionId, $cl.Substring(0,[Math]::Min(80,$cl.Length)) }
Section 'relaunch log'
if (Test-Path 'C:\AI\hydra-local\logs\relaunch.log') { Get-Content 'C:\AI\hydra-local\logs\relaunch.log' -Tail 6 | ForEach-Object { '  ' + ($_ -replace '\s+',' ').Trim() } }
Section 'what it publishes'
try { $s = Invoke-RestMethod 'http://127.0.0.1:8127/api/state?prefix=node.xpsw' -TimeoutSec 6; ($s | ConvertTo-Json -Compress -Depth 3).Substring(0,[Math]::Min(300,($s|ConvertTo-Json -Compress -Depth 3).Length)) } catch { '  state door not answering yet' }
'XPSW RAISE DONE'
