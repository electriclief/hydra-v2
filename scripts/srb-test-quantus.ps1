# 160-second mining test on the 980 Ti: does quantus run on Maxwell, and does the pool accept a share?
# Starts the miner, lets it run, stops it, then reads its own log - SRBMiner writes nothing to a pipe.
param([int]$Seconds = 160, [string]$ApiPort = '61234', [string]$Worker = 'leafdriving2.unmineable_miner_gtx980')

$dir = 'C:\AI\miners\srbminer'
$exe = Join-Path $dir 'SRBMiner-MULTI.exe'
$log = 'C:\AI\logs\srb-test.log'
$out = 'C:\AI\logs\srb-test.out'

Remove-Item $log, $out -Force -ErrorAction SilentlyContinue

$args = @(
  '--pool', 'stratum+tcp://quantus.unmineable.com:3333',
  '--wallet', $Worker,
  '--disable-cpu',
  '--algorithm', 'quantus',
  '--api-enable', '--api-port', $ApiPort,
  '--disable-worker-watchdog',
  '--gpu-sensors-disable',
  '--log-file', $log,
  '--extended-log'
)
'starting: ' + $exe
'args    : ' + ($args -join ' ')

$p = Start-Process -FilePath $exe -ArgumentList $args -WorkingDirectory $dir -PassThru -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError "$out.err"
'pid     : ' + $p.Id
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$alive = $true
while ($sw.Elapsed.TotalSeconds -lt $Seconds) {
  if ($p.HasExited) { $alive = $false; break }
  Start-Sleep -Seconds 5
}
if ($alive) {
  'ran {0}s - stopping' -f $Seconds
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
} else {
  'EXITED EARLY with code {0}' -f $p.ExitCode
}

'--- log lines that matter'
$lines = @()
if (Test-Path $log) { $lines = Get-Content $log } else { 'no log file written at ' + $log }
$lines | Where-Object { $_ -match '(?i)algorithm|hashrate|accepted|rejected|share|error|not supported|failed|cuda|device|pool' } |
  Select-Object -Last 30 | ForEach-Object { '  ' + $_ }
'--- last 12 lines of the log'
$lines | Select-Object -Last 12 | ForEach-Object { '  ' + $_ }
if (Test-Path $out) { '--- stdout tail'; Get-Content $out -Tail 8 | ForEach-Object { '  ' + $_ } }
if (Test-Path "$out.err") { '--- stderr tail'; Get-Content "$out.err" -Tail 8 | ForEach-Object { '  ' + $_ } }
