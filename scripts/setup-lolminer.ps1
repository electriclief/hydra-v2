# Install lolMiner on this box and ask it which devices it will actually mine on.
# SRBMiner 3.8.6 refuses Maxwell on its CUDA path ("not on list of supported devices"), so the question
# "what still hashes on a 2015 card" has to be answered by a different miner, not by a different flag.
$ErrorActionPreference = 'Stop'
function Say($t) { Write-Host $t }

$root = 'C:\AI\miners'
$dir = Join-Path $root 'lolminer'
$zip = Join-Path $env:TEMP 'lolminer.zip'
$url = 'https://github.com/Lolliedieb/lolMiner-releases/releases/download/1.98a/lolMiner_v1.98a_Win64.zip'

$me = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = (New-Object Security.Principal.WindowsPrincipal($me)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Say ('account {0}  administrator={1}' -f $me.Name, $isAdmin)
if ($isAdmin) { Add-MpPreference -ExclusionPath $root -ErrorAction SilentlyContinue }

New-Item -ItemType Directory -Force $dir, 'C:\AI\logs' | Out-Null

Say 'downloading ...'
& curl.exe -L --retry 3 --fail -o $zip $url
if ($LASTEXITCODE -ne 0) { throw "curl exited $LASTEXITCODE" }
Say ('  got {0:N1} MB' -f ((Get-Item $zip).Length / 1MB))

$tmp = Join-Path $env:TEMP 'lolminer-unzip'
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $tmp -Force
Get-ChildItem $tmp -Recurse -File | ForEach-Object { Copy-Item $_.FullName (Join-Path $dir $_.Name) -Force }
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $zip -Force -ErrorAction SilentlyContinue

$exe = Join-Path $dir 'lolMiner.exe'
if (-not (Test-Path $exe)) {
  $exe = (Get-ChildItem $dir -Recurse -Filter 'lolMiner.exe' | Select-Object -First 1).FullName
}
Say ('installed: {0}  v{1}' -f $exe, (Get-Item $exe).VersionInfo.FileVersion)

Say '--- device list, as lolMiner sees it'
$out = 'C:\AI\logs\lol-devices.txt'
& $exe --list-devices *> $out
Get-Content $out | Select-Object -First 40 | ForEach-Object { '  ' + $_ }
