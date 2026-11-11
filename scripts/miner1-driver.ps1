# Install the staged NVIDIA driver on miner1 and report the truth afterwards.
# The earlier attempt produced no installer process, no C:\NVIDIA tree and no nvidia-smi, so this run captures the exit
# code and both installer logs instead of assuming anything.
$ErrorActionPreference = 'Continue'
$exe = 'C:\AI\tools\dl\nvidia-582.66.exe'
$log = 'C:\AI\logs\driver-install.txt'

if (-not (Test-Path $exe)) { 'INSTALLER MISSING at ' + $exe; return }
'installer  : {0:N0} MB   {1}' -f ((Get-Item $exe).Length / 1MB), (Get-Item $exe).LastWriteTime
'now        : {0}' -f (Get-Date).ToString('HH:mm:ss')

'--- running it silently'
$sw = [Diagnostics.Stopwatch]::StartNew()
$p = Start-Process -FilePath $exe -ArgumentList '-s', '-noreboot' -Wait -PassThru -ErrorAction SilentlyContinue
$sw.Stop()
if ($p) { 'exit code  : {0}   after {1:N0} s' -f $p.ExitCode, $sw.Elapsed.TotalSeconds } else { 'Start-Process returned nothing' }

'--- installer logs'
foreach ($l in @(
    'C:\ProgramData\NVIDIA Corporation\Installer2\Installer.log',
    'C:\NVIDIA\DisplayDriver\install.log',
    "$env:TEMP\nvidia-install.log")) {
  if (Test-Path $l) {
    '  {0}  ({1:N1} KB, written {2})' -f $l, ((Get-Item $l).Length / 1KB), (Get-Item $l).LastWriteTime
    Get-Content $l -Tail 8 | ForEach-Object { '    ' + $_ }
  }
}

Start-Sleep -Seconds 10
'--- after'
if (Test-Path 'C:\Windows\System32\nvidia-smi.exe') {
  & 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=name,driver_version,memory.total,memory.used,utilization.gpu --format=csv,noheader
} else { '  nvidia-smi still absent' }
Get-PnpDevice -PresentOnly -Class Display -ErrorAction SilentlyContinue |
  ForEach-Object { '  {0,-34} {1,-8} {2}' -f $_.FriendlyName, $_.Status, $_.Problem }
if (Test-Path 'C:\NVIDIA') { 'C:\NVIDIA exists: ' + (@(Get-ChildItem 'C:\NVIDIA' -Recurse -Filter *.inf -ErrorAction SilentlyContinue).Count) + ' inf files' }
'DRIVER-INSTALL DONE'
