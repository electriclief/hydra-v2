$ErrorActionPreference = 'Continue'
'== full shelf log (core/mirror mentions)'
if (Test-Path 'C:\AI\hydra-local\logs\shelf.log') {
  Get-Content 'C:\AI\hydra-local\logs\shelf.log' | Select-String -Pattern 'core|mirror|events|error|fail' | Select-Object -Last 12 | ForEach-Object { '  | ' + ($_.Line -replace '\s+',' ').Trim() }
  '  --- last 6 lines of the file'
  Get-Content 'C:\AI\hydra-local\logs\shelf.log' -Tail 6 | ForEach-Object { '  | ' + ($_ -replace '\s+',' ').Trim() }
}
'== do Core and Mirror exist and can they start'
foreach ($m in 'Core','Mirror','Event_Handler') {
  $p = "C:\AI\hydra-local\module\$m\src\main.js"
  '  {0,-14} src/main.js: {1}' -f $m, (Test-Path $p)
}
'== try Core by hand (5 s)'
$node = 'C:\Program Files\nodejs\node.exe'
if (Test-Path 'C:\AI\hydra-local\module\Core\src\main.js') {
  Push-Location 'C:\AI\hydra-local\module\Core'
  $p = Start-Process -FilePath $node -ArgumentList @('src/main.js','--port','8136','--host','0.0.0.0') -WorkingDirectory 'C:\AI\hydra-local\module\Core' -RedirectStandardOutput 'C:\AI\hydra-local\logs\core-try.out' -RedirectStandardError 'C:\AI\hydra-local\logs\core-try.err' -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 12
  '  exited: {0}  port 8136 listening: {1}' -f $p.HasExited, [bool](Get-NetTCPConnection -State Listen -LocalPort 8136 -ErrorAction SilentlyContinue)
  if (Test-Path 'C:\AI\hydra-local\logs\core-try.out') { Get-Content 'C:\AI\hydra-local\logs\core-try.out' -Tail 6 | ForEach-Object { '  out| ' + ($_ -replace '\s+',' ').Trim() } }
  if (Test-Path 'C:\AI\hydra-local\logs\core-try.err') { Get-Content 'C:\AI\hydra-local\logs\core-try.err' -Tail 6 | ForEach-Object { '  err! ' + ($_ -replace '\s+',' ').Trim() } }
  Pop-Location
}
'1660 CORE DONE'
