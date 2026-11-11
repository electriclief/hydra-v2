$ErrorActionPreference = 'Continue'
# No nested quoting: the path has no spaces, so cmd /c <path> needs no quotes at all.
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = 'cmd.exe /c C:\AI\hydra-local\scripts\raise-1660-core.cmd' }
'  returnValue=' + $r.ReturnValue + '  pid=' + $r.ProcessId
Start-Sleep -Seconds 15
foreach ($p in 8136,8137) {
  $c = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { '  {0} UP pid {1}' -f $p, $c.OwningProcess } else { '  {0} ---' -f $p }
}
'  --- core.log'; Get-Content 'C:\AI\hydra-local\logs\core.log' -Tail 3 -ErrorAction SilentlyContinue | ForEach-Object { '   | ' + ($_ -replace '\s+',' ').Trim() }
'  --- mirror.log'; Get-Content 'C:\AI\hydra-local\logs\mirror.log' -Tail 3 -ErrorAction SilentlyContinue | ForEach-Object { '   | ' + ($_ -replace '\s+',' ').Trim() }
'RAISE DONE'
