# Prove the wall renders and names THIS node (not the box it was written on), without opening a window.
# Redirected output is the append-only branch: one line per event plus a heartbeat.
$ErrorActionPreference = 'Continue'
$wall = 'C:\AI\hydra-local\scripts\miner-wall.ps1'
$out = 'C:\AI\logs\wall-test.out'
$err = 'C:\AI\logs\wall-test.err'
Remove-Item $out, $err -Force -ErrorAction SilentlyContinue

$p = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $wall) `
  -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 14
if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
'--- stdout'
if (Test-Path $out) { Get-Content $out | Select-Object -First 12 | ForEach-Object { '  ' + $_ } } else { '  none' }
'--- stderr'
if (Test-Path $err) { Get-Content $err -Tail 6 | ForEach-Object { '  ' + $_ } } else { '  none' }
