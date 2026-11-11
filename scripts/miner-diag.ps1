# Why 0 H/s? Two questions: what did SRBMiner's log actually complain about, and can lolMiner hash the same algo on
# this card through its CUDA path. Sixty seconds of lolMiner is enough to tell "miner can't" from "algorithm can't".
$ErrorActionPreference = 'Continue'
'=== SRBMiner log, lines that are not hashrate chatter'
$log = 'C:\AI\logs\bench-miner.log'
if (Test-Path $log) {
  Get-Content $log | Where-Object { $_ -match '(?i)error|fail|kernel|warning|cuda|opencl|platform|not |algo' } |
    Select-Object -Last 20 | ForEach-Object { '  ' + $_ }
} else { '  no log at ' + $log }

'=== any miner still alive'
Get-Process SRBMiner-MULTI, lolMiner -ErrorAction SilentlyContinue | ForEach-Object { '  stopping ' + $_.ProcessName; Stop-Process -Id $_.Id -Force }

'=== lolMiner, XELIS, 60 s'
$lol = 'C:\AI\miners\lolminer\lolMiner.exe'
if (Test-Path $lol) {
  $out = 'C:\AI\logs\lol-xelis.txt'
  Remove-Item $out -Force -ErrorAction SilentlyContinue
  $p = Start-Process -FilePath $lol -WorkingDirectory 'C:\AI\miners\lolminer' -PassThru -WindowStyle Hidden -ArgumentList @(
    '--algo', 'XELIS', '--pool', 'xelishash.unmineable.com:3333',
    '--user', 'leafdriving2.unmineable_miner_miner1',
    '--apiport', '60203', '--log', 'on', '--logfile', $out
  ) -RedirectStandardOutput 'C:\AI\logs\lol-xelis-stdout.txt' -RedirectStandardError 'C:\AI\logs\lol-xelis-stderr.txt'
  Start-Sleep -Seconds 60
  try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { }
  Get-Process lolMiner -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  foreach ($f in $out, 'C:\AI\logs\lol-xelis-stdout.txt', 'C:\AI\logs\lol-xelis-stderr.txt') {
    if (Test-Path $f) {
      '' ; '-- ' + $f
      Get-Content $f | Where-Object { $_ -match '(?i)speed|h/s|kh/s|mh/s|error|algo|device|share|driver' } |
        Select-Object -Last 12 | ForEach-Object { '  ' + ($_ -replace "`e\[[0-9;]*m", '') }
    }
  }
} else { '  lolMiner missing' }
'MINER-DIAG DONE'
