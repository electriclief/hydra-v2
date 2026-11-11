$ErrorActionPreference = 'Continue'
$root = 'C:\AI\hydra-local'
'host: ' + $env:COMPUTERNAME

'--- echidna'
@((Invoke-RestMethod 'http://127.0.0.1:8125/api/processes' -TimeoutSec 8).processes | Where-Object { $_.name -like 'echidna*' }) | ForEach-Object {
  '  {0} {1} pid {2} err {3}' -f $_.id, $_.life, $_.pid, $_.error
}
'  port 8138 listening: ' + [bool](Get-NetTCPConnection -State Listen -LocalPort 8138 -ErrorAction SilentlyContinue)
'  main.js: ' + (Test-Path (Join-Path $root 'module\Echidna\public\js\main.js'))
'  echidna node_modules: ' + (Test-Path (Join-Path $root 'module\Echidna\node_modules'))

'--- launchers'
foreach ($f in 'relaunch-hydra.cmd', 'start-hydra.cmd', 'shelf-headless.mjs') { '  {0}: {1}' -f $f, (Test-Path (Join-Path $root $f)) }

'--- node.json today'
$nj = Join-Path $root 'module\Menu\data\node.json'
Get-Content $nj -Raw | ConvertFrom-Json | ConvertTo-Json -Depth 5
'1660 STATE DONE'
