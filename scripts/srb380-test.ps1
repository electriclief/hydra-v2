# SRBMiner 3.8.6 refuses to start on this Turing card ("GPU recovery failed ... ref=RDEB6381D") on both the 2021 and the
# 2026 driver. jims' Turing-era equivalent runs 3.8.0 happily, so test the older build rather than theorise.
# Also clears whatever recovery state 3.8.6 left behind, because the message names it.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }

Section 'what state did 3.8.6 leave'
Get-ChildItem 'C:\AI\miners\srbminer' -Force -ErrorAction SilentlyContinue |
  Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize | Out-String -Width 110 | Write-Host
$appdata = Join-Path $env:APPDATA 'SRBMiner-MULTI'
if (Test-Path $appdata) { '  appdata: ' + $appdata ; Get-ChildItem $appdata -Recurse -Force | Select-Object FullName, Length | Format-Table -AutoSize | Out-String }

Section 'clear crash state'
foreach ($pat in 'C:\AI\miners\srbminer\*.rec', 'C:\AI\miners\srbminer\*.recovery', 'C:\AI\miners\srbminer\recovery*') {
  Get-ChildItem $pat -Force -ErrorAction SilentlyContinue | ForEach-Object { '  removing ' + $_.Name; Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
}
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

Section 'SRBMiner 3.8.0'
$dir = 'C:\AI\miners\srb380'
$exe = Join-Path $dir 'SRBMiner-MULTI.exe'
if (-not (Test-Path $exe)) {
  $zip = 'C:\AI\tools\dl\srb380.zip'
  & curl.exe -L --retry 3 --fail --silent --show-error -o $zip 'https://github.com/doktor83/SRBMiner-Multi/releases/download/3.8.0/SRBMiner-Multi-3-8-0-win64.zip'
  if (Test-Path $zip) {
    $tmp = 'C:\AI\tools\dl\srb380x'
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    Expand-Archive $zip -DestinationPath $tmp -Force
    New-Item -ItemType Directory -Force $dir | Out-Null
    Get-ChildItem $tmp -Recurse -File | ForEach-Object { Copy-Item $_.FullName (Join-Path $dir $_.Name) -Force }
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}
if (-not (Test-Path $exe)) { '  download failed - stopping'; return }
'  binary: {0:N1} MB' -f ((Get-Item $exe).Length / 1MB)

Section '3.8.0 device list'
(& $exe --list-devices 2>&1 | Select-Object -Last 6) | ForEach-Object { '  ' + ($_ -replace "`0", '') }

Section '3.8.0 mining 100 s'
$log = 'C:\AI\logs\srb380-test.txt'
Remove-Item $log -Force -ErrorAction SilentlyContinue
$p = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru -WindowStyle Hidden -ArgumentList @(
  '--algorithm', 'xelishashv3', '--pool', 'stratum+tcp://xelishash.unmineable.com:3333',
  '--wallet', 'leafdriving2.unmineable_miner_miner1', '--disable-cpu',
  '--api-enable', '--api-port', '60209', '--gpu-sensors-disable', '--log-file', $log
)
Start-Sleep -Seconds 100
try {
  $a = Invoke-RestMethod 'http://127.0.0.1:60209/' -TimeoutSec 8
  $alg = @($a.algorithms)[0]
  '  RATE    : {0} H/s' -f $alg.hashrate.'15min'
  '  SHARES  : accepted {0} rejected {1}' -f $alg.shares.accepted, $alg.shares.rejected
} catch { '  API     : ' + $_.Exception.Message }
'  exited  : {0}' -f $p.HasExited
if (Test-Path 'C:\Windows\System32\nvidia-smi.exe') {
  & 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=utilization.gpu,memory.used,temperature.gpu,power.draw,clocks.sm --format=csv,noheader
}
try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { }
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
if (Test-Path $log) { Get-Content $log | Where-Object { $_ -match '(?i)h/s|error|cuda|kernel|init|share' } | Select-Object -Last 10 | ForEach-Object { '  ' + $_ } }
'SRB380 DONE'
