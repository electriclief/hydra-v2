# SRBMiner produced no log and no API - so capture its raw stdout/stderr and its exit code. No guessing.
$ErrorActionPreference = 'Continue'
$srb = 'C:\AI\miners\srbminer\SRBMiner-MULTI.exe'
$o = 'C:\AI\logs\srb-out.txt'; $e = 'C:\AI\logs\srb-err.txt'
Remove-Item $o, $e -Force -ErrorAction SilentlyContinue
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

'=== list-devices first (does the binary still run at all?)'
$ld = & $srb --list-devices 2>&1
($ld | Select-Object -Last 8) | ForEach-Object { '  ' + ($_ -replace "`0", '') }

'=== 45 s run, output captured'
$p = Start-Process -FilePath $srb -WorkingDirectory 'C:\AI\miners\srbminer' -PassThru -WindowStyle Hidden `
  -ArgumentList @('--algorithm', 'xelishashv3', '--pool', 'stratum+tcp://xelishash.unmineable.com:3333',
  '--wallet', 'leafdriving2.unmineable_miner_miner1', '--disable-cpu', '--api-enable', '--api-port', '60208',
  '--gpu-sensors-disable') -RedirectStandardOutput $o -RedirectStandardError $e
Start-Sleep -Seconds 45
$alive = -not $p.HasExited
'exited     : {0}' -f (-not $alive)
if (-not $alive) { 'exit code  : {0}' -f $p.ExitCode }
'--- stdout'
if (Test-Path $o) { Get-Content $o | Where-Object { $_.Trim() } | Select-Object -Last 20 | ForEach-Object { '  ' + ($_ -replace "`0", '') } }
'--- stderr'
if (Test-Path $e) { Get-Content $e | Where-Object { $_.Trim() } | Select-Object -Last 10 | ForEach-Object { '  ' + ($_ -replace "`0", '') } }
'--- api'
try { $a = Invoke-RestMethod 'http://127.0.0.1:60208/' -TimeoutSec 6; $alg = @($a.algorithms)[0]; '  rate {0}  accepted {1}' -f $alg.hashrate.'15min', $alg.shares.accepted } catch { '  ' + $_.Exception.Message }
try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { }
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
'SRB-CAPTURE DONE'
