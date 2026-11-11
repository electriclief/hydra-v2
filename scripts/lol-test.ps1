# 150-second lolMiner test on the 980 Ti. lolMiner 1.98a sees the card on CUDA, SRBMiner 3.8.6 does not.
# Tests the algorithm the operator's own pool (unMineable) answers for, and reports hashrate + shares from the log.
param(
  [string]$Algo = 'AUTOLYKOS2',
  [string]$Pool = 'autolykos2.unmineable.com:3333',
  [string]$Wallet = 'leafdriving2.unmineable_miner_gtx980',
  [int]$Seconds = 150,
  [string]$ApiPort = '61235'
)

$dir = 'C:\AI\miners\lolminer'
$exe = Join-Path $dir 'lolMiner.exe'
$log = "C:\AI\logs\lol-$Algo.log"
Remove-Item $log -Force -ErrorAction SilentlyContinue

$args = @(
  '--algo', $Algo,
  '--pool', $Pool,
  '--user', $Wallet,
  '--apiport', $ApiPort,
  '--log', 'on',
  '--logfile', $log,
  '--nocolor'
)
'starting: ' + $exe
'args    : ' + ($args -join ' ')
$p = Start-Process -FilePath $exe -ArgumentList $args -WorkingDirectory $dir -PassThru -WindowStyle Hidden -RedirectStandardOutput "$log.stdout" -RedirectStandardError "$log.stderr"
'pid     : ' + $p.Id
$sw = [System.Diagnostics.Stopwatch]::StartNew()
while ($sw.Elapsed.TotalSeconds -lt $Seconds -and -not $p.HasExited) { Start-Sleep -Seconds 5 }
if (-not $p.HasExited) { 'ran {0}s - stopping' -f $Seconds; Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue; Start-Sleep 2 }
else { 'EXITED EARLY code ' + $p.ExitCode }

'--- the lines that answer "is it mining"'
if (Test-Path $log) {
  $lines = Get-Content $log
  $lines | Where-Object { $_ -match '(?i)algorithm|total speed|accepted|rejected|share|error|failed|not supported|authorized|new job|dag' } |
    Select-Object -Last 30 | ForEach-Object { '  ' + $_ }
  '--- last 10 lines'
  $lines | Select-Object -Last 10 | ForEach-Object { '  ' + $_ }
} else {
  'no log at ' + $log
  if (Test-Path "$log.stdout") { '--- stdout'; Get-Content "$log.stdout" -Tail 25 | ForEach-Object { '  ' + $_ } }
  if (Test-Path "$log.stderr") { '--- stderr'; Get-Content "$log.stderr" -Tail 10 | ForEach-Object { '  ' + $_ } }
}
