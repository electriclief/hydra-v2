$ErrorActionPreference = 'Continue'
$node = 'C:\Program Files\nodejs\node.exe'
$shelf = 'C:\AI\hydra-local\shelf-headless.mjs'
$out = 'C:\AI\hydra-local\logs\shelf-try.out'
$err = 'C:\AI\hydra-local\logs\shelf-try.err'
New-Item -ItemType Directory -Force -Path 'C:\AI\hydra-local\logs' | Out-Null
Remove-Item $out,$err -Force -ErrorAction SilentlyContinue
'== node: ' + (& $node -v)
$env:HYDRA_NODE = $node
$env:HYDRA_HOST = '0.0.0.0'
$env:HYDRA_MODULE_ROOT = 'C:\AI\hydra-local\module'
$p = Start-Process -FilePath $node -ArgumentList @($shelf) -WorkingDirectory 'C:\AI\hydra-local' -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -WindowStyle Hidden
'  started pid ' + $p.Id
Start-Sleep -Seconds 20
'  exited: ' + $p.HasExited + '  exitCode: ' + $(if ($p.HasExited) { $p.ExitCode } else { 'running' })
'== stdout'
if (Test-Path $out) { Get-Content $out -Tail 15 | ForEach-Object { '  | ' + $_ } } else { '  (none)' }
'== stderr'
if (Test-Path $err) { Get-Content $err -Tail 15 | ForEach-Object { '  ! ' + $_ } } else { '  (none)' }
'== doors'
foreach ($port in 8125,8127,8133,8136,8137) {
  $c = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { '  {0} UP pid {1}' -f $port, $c.OwningProcess } else { '  {0} ---' -f $port }
}
if (-not $p.HasExited) { '  leaving it running' }
'1660 TRY DONE'
