# =====================================================================================
#  CPU MINER - install xmrig, run it for a bounded two minutes, and MEASURE it.
#
#  Why a bounded test first: a CPU miner's yield is a number or it is a rumour. This runs the real thing against the real
#  pool for 150 seconds, samples xmrig's own API, prints hashrate and shares, and stops. Nothing is left running and
#  nothing is wired into the guard until there is a measured number to wire.
#
#  Threads default to 2: the card needs cores to be fed, and the point of this miner is to use what the GPU does not want.
# =====================================================================================
param(
  [int]$Threads = 2,
  [int]$Seconds = 150,
  [string]$Pool = 'rx.unmineable.com:3333',
  [string]$Wallet = 'leafdriving2.unmineable_miner_cpu01',
  [int]$ApiPort = 60131
)
$ErrorActionPreference = 'Stop'
$dir = 'C:\AI\tools\xmrig'
$exe = Join-Path $dir 'xmrig.exe'

if (-not (Test-Path $exe)) {
  'installing xmrig'
  New-Item -ItemType Directory -Force $dir | Out-Null
  $zip = Join-Path $env:TEMP 'xmrig.zip'
  $rel = Invoke-RestMethod 'https://api.github.com/repos/xmrig/xmrig/releases/latest' -TimeoutSec 30
  $asset = $rel.assets | Where-Object { $_.name -like '*windows-x64.zip' } | Select-Object -First 1
  '  version: ' + $rel.tag_name + '  asset: ' + $asset.name
  Invoke-WebRequest $asset.browser_download_url -OutFile $zip -TimeoutSec 180
  '  downloaded ' + [math]::Round((Get-Item $zip).Length / 1MB, 2) + ' MB'
  $tmp = Join-Path $env:TEMP ('xmrig-' + [guid]::NewGuid().ToString('n').Substring(0, 6))
  Expand-Archive $zip -DestinationPath $tmp -Force
  $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
  Copy-Item (Join-Path $inner.FullName '*') $dir -Recurse -Force
  Remove-Item $tmp, $zip -Recurse -Force -ErrorAction SilentlyContinue
}
if (-not (Test-Path $exe)) { throw "xmrig.exe is not at $exe after install" }
'  xmrig: ' + (& $exe --version 2>&1 | Select-Object -First 1)

$log = 'C:\AI\logs\xmrig-test.log'
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
$argsList = @(
  '-o', $Pool,
  '-u', $Wallet,
  '-p', 'x',
  '-a', 'rx/0',
  '--threads', "$Threads",
  '--http-host', '127.0.0.1',
  '--http-port', "$ApiPort",
  '--no-color',
  '--print-time', '10',
  '--log-file', $log
)
'starting: xmrig ' + ($argsList -join ' ')
$p = Start-Process -FilePath $exe -ArgumentList $argsList -WorkingDirectory $dir -PassThru -WindowStyle Hidden
'  pid ' + $p.Id

# sample its own numbers every 15 s; the last sample is the measurement
$samples = @()
$deadline = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 15
  try {
    $s = Invoke-RestMethod "http://127.0.0.1:$ApiPort/2/summary" -TimeoutSec 5
    $samples += [pscustomobject]@{
      at       = (Get-Date).ToString('HH:mm:ss')
      h10s     = $s.hashrate.'10s'
      h60s     = $s.hashrate.'60s'
      h15m     = $s.hashrate.'15m'
      shares   = $s.results_shares_good
      rejected = $s.results_shares_total - $s.results_shares_good
      algo     = $s.algo
      pool     = $s.connection.pool
      uptime   = $s.uptime
    }
  }
  catch {
    $samples += [pscustomobject]@{ at = (Get-Date).ToString('HH:mm:ss'); h10s = $null; h60s = $null; h15m = $null; shares = $null; rejected = $null; algo = ''; pool = 'api not answering yet'; uptime = 0 }
  }
}

Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
''
'=== samples (xmrig''s own API, 15 s apart)'
$samples | Format-Table -AutoSize | Out-String -Width 140
$last = $samples | Where-Object { $null -ne $_.h10s } | Select-Object -Last 1
if ($last) {
  ''
  'MEASURED  ' + $last.h10s + ' H/s (10s) · ' + $last.h60s + ' H/s (60s) · ' + $last.shares + ' shares accepted · ' + $last.rejected + ' rejected · ' + $last.algo
}
''
'=== the miner''s own log, last 12 lines'
if (Test-Path $log) { Get-Content $log -Tail 12 | ForEach-Object { '  ' + $_ } } else { '  (no log file)' }
''
'process still running? ' + [bool](Get-Process -Id $p.Id -ErrorAction SilentlyContinue)
