# A/B the miner build on a Maxwell card: does 1.76 hash nearer the card's class than 1.98a's 1.53 MH/s?
# Downloads to its own folder so the two builds can live side by side, then runs the same 150-second etchash test.
param([int]$Seconds = 150)

$ErrorActionPreference = 'Stop'
$dir = 'C:\AI\miners\lol176'
$zip = Join-Path $env:TEMP 'lol176.zip'
$url = 'https://github.com/Lolliedieb/lolMiner-releases/releases/download/1.76/lolMiner_v1.76_Win64.zip'
New-Item -ItemType Directory -Force $dir, 'C:\AI\logs' | Out-Null

if (-not (Test-Path (Join-Path $dir 'lolMiner.exe'))) {
  & curl.exe -L --retry 3 --fail -o $zip $url
  if ($LASTEXITCODE -ne 0) { throw "curl exited $LASTEXITCODE" }
  $tmp = Join-Path $env:TEMP 'lol176-unzip'
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  Get-ChildItem $tmp -Recurse -File | ForEach-Object { Copy-Item $_.FullName (Join-Path $dir $_.Name) -Force }
  Remove-Item $tmp, $zip -Recurse -Force -ErrorAction SilentlyContinue
}
$exe = Join-Path $dir 'lolMiner.exe'
'installed: {0}  v{1}' -f $exe, (Get-Item $exe).VersionInfo.FileVersion

$log = 'C:\AI\logs\lol176-ETCHASH.log'
Remove-Item $log -Force -ErrorAction SilentlyContinue
$args = @('--algo', 'ETCHASH', '--pool', 'etchash.unmineable.com:3333',
  '--user', 'leafdriving2.unmineable_miner_gtx980', '--apiport', '61236',
  '--log', 'on', '--logfile', $log)
'run: ' + ($args -join ' ')
$p = Start-Process -FilePath $exe -ArgumentList $args -WorkingDirectory $dir -PassThru -WindowStyle Hidden -RedirectStandardOutput "$log.stdout" -RedirectStandardError "$log.stderr"
$sw = [System.Diagnostics.Stopwatch]::StartNew()
while ($sw.Elapsed.TotalSeconds -lt $Seconds -and -not $p.HasExited) { Start-Sleep 5 }
if (-not $p.HasExited) { 'ran {0}s - stopping' -f $Seconds; Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue; Start-Sleep 2 } else { 'EXITED EARLY ' + $p.ExitCode }

if (Test-Path $log) {
  $lines = Get-Content $log
  $lines | Where-Object { $_ -match '(?i)speed|accepted|share|error|not supported|authorized' } | Select-Object -Last 18 | ForEach-Object { '  ' + $_ }
  '--- last 8'
  $lines | Select-Object -Last 8 | ForEach-Object { '  ' + $_ }
} else { 'no log; stdout:'; Get-Content "$log.stdout" -Tail 15 -ErrorAction SilentlyContinue | ForEach-Object { '  ' + $_ } }
