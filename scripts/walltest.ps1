# Run the GPU wall headlessly for 12 seconds and capture exactly what it says - a black window means
# nothing until the error text is in hand.
$ErrorActionPreference = 'Continue'
$out = 'C:\AI\reports\wall-out.txt'
$err = 'C:\AI\reports\wall-err.txt'
Remove-Item $out, $err -Force -ErrorAction SilentlyContinue

$p = Start-Process powershell -PassThru -WindowStyle Hidden `
      -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'C:\AI\hydra-local\scripts\miner-wall.ps1' `
      -RedirectStandardOutput $out -RedirectStandardError $err
Start-Sleep -Seconds 12
if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force; 'still running after 12s (expected for a live wall) - killed' }
else { 'exited early with code ' + $p.ExitCode }

'--- stdout (last 30)'
if (Test-Path $out) { Get-Content $out -Tail 30 | ForEach-Object { $_ } }
'--- stderr (last 20)'
if (Test-Path $err) { Get-Content $err -Tail 20 | ForEach-Object { $_ } }

'--- is node.json readable, and what does it say the card is?'
$nj = 'C:\AI\hydra-local\module\Menu\data\node.json'
if (Test-Path $nj) {
  try { $j = Get-Content $nj -Raw | ConvertFrom-Json; 'gpu = ' + $j.gpu + ' | ref = ' + $j.ref }
  catch { 'node.json parse error: ' + $_.Exception.Message }
} else { 'no node.json at ' + $nj }

'--- miner api reachable from here?'
try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:60130/' -TimeoutSec 4; 'api ok, algo ' + (@($r.algorithms)[0].name) }
catch { 'api down: ' + $_.Exception.Message }
