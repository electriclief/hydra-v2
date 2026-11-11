$ErrorActionPreference = 'Continue'
$ech = 'C:\AI\hydra-local\module\Echidna'
'host: ' + $env:COMPUTERNAME
'  package.json: ' + (Test-Path (Join-Path $ech 'package.json'))
'  package-lock.json: ' + (Test-Path (Join-Path $ech 'package-lock.json'))
'  node_modules: ' + (Test-Path (Join-Path $ech 'node_modules'))
if (Test-Path (Join-Path $ech 'node_modules')) {
  '  entries: ' + @(Get-ChildItem (Join-Path $ech 'node_modules') -ErrorAction SilentlyContinue).Count
}
if (Test-Path 'C:\AI\logs\npm-echidna.log') {
  '--- npm log tail'
  Get-Content 'C:\AI\logs\npm-echidna.log' -Tail 10 | ForEach-Object { '  ' + $_ }
} else { '  no npm log' }
'--- does echidna start now?'
@((Invoke-RestMethod 'http://127.0.0.1:8125/api/processes' -TimeoutSec 8).processes | Where-Object { $_.name -like 'echidna*' }) | ForEach-Object { '  {0} {1} err {2}' -f $_.id, $_.life, $_.error }
'NPM CHECK DONE'
