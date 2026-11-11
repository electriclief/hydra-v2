# Where the driver install actually is: is a setup process alive, is nvidia-smi there, what does the display class say.
$ErrorActionPreference = 'Continue'
'now        : {0}' -f (Get-Date).ToString('HH:mm:ss')
'--- processes that could be the installer'
$ps = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '(?i)setup|nv|7z|nvidia' })
if ($ps.Count) {
  $ps | Select-Object ProcessName, Id, @{ n = 'cpuS'; e = { [int]$_.CPU } }, @{ n = 'MB'; e = { [int]($_.WorkingSet64 / 1MB) } } |
    Format-Table -AutoSize | Out-String -Width 100 | Write-Host
} else { '  none' }
'--- nvidia-smi'
if (Test-Path 'C:\Windows\System32\nvidia-smi.exe') { & 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=name,driver_version,memory.total --format=csv,noheader }
else { '  absent' }
'--- display class'
Get-PnpDevice -PresentOnly -Class Display -ErrorAction SilentlyContinue |
  ForEach-Object { '  {0,-34} {1,-8} {2}' -f $_.FriendlyName, $_.Status, $_.Problem }
'--- extracted driver tree'
if (Test-Path 'C:\NVIDIA') {
  Get-ChildItem 'C:\NVIDIA' -Directory -Recurse -ErrorAction SilentlyContinue | Select-Object -First 4 -ExpandProperty FullName
  $inf = @(Get-ChildItem 'C:\NVIDIA' -Filter '*.inf' -Recurse -ErrorAction SilentlyContinue)
  '  inf files: {0}' -f $inf.Count
} else { '  no C:\NVIDIA yet' }
'--- log file the installer writes'
$l = 'C:\ProgramData\NVIDIA Corporation\Installer2\Installer.log'
if (Test-Path $l) { '  ' + (Get-Item $l).LastWriteTime + '  ' + [math]::Round((Get-Item $l).Length / 1KB, 1) + ' KB' } else { '  no Installer.log' }
