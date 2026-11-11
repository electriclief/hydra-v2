# Install SRBMiner-MULTI on this box, from GitHub, with the Defender exclusion in place first.
# Everything lands under C:\AI\miners\srbminer and nothing is started here.
$ErrorActionPreference = 'Stop'
function Say($t) { Write-Host $t }

$root = 'C:\AI\miners'
$dir = Join-Path $root 'srbminer'
$zip = Join-Path $env:TEMP 'srbminer.zip'
$url = 'https://github.com/doktor83/SRBMiner-Multi/releases/download/3.8.6/SRBMiner-Multi-3-8-6-win64.zip'

$me = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = (New-Object Security.Principal.WindowsPrincipal($me)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Say ('account {0}  administrator={1}' -f $me.Name, $isAdmin)

if ($isAdmin) {
  Add-MpPreference -ExclusionPath $root -ErrorAction SilentlyContinue
  Say ('defender exclusions: ' + (((Get-MpPreference).ExclusionPath) -join ', '))
} else {
  Say 'NOT ADMIN - cannot add a Defender exclusion; the miner may be quarantined after download'
}

New-Item -ItemType Directory -Force $dir | Out-Null

# download with curl.exe: Invoke-WebRequest stalls on large files here
Say 'downloading ...'
& curl.exe -L --retry 3 --fail -o $zip $url
if ($LASTEXITCODE -ne 0) { throw "curl exited $LASTEXITCODE" }
Say ('  got {0:N1} MB' -f ((Get-Item $zip).Length / 1MB))

# the zip contains a top-level folder; flatten it into $dir
$tmp = Join-Path $env:TEMP 'srbminer-unzip'
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $tmp -Force
$inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
$src = if ($inner) { $inner.FullName } else { $tmp }
Get-ChildItem $src -Recurse -File | ForEach-Object {
  $dest = Join-Path $dir $_.Name
  Copy-Item $_.FullName $dest -Force
}
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $zip -Force -ErrorAction SilentlyContinue

$exe = Join-Path $dir 'SRBMiner-MULTI.exe'
if (-not (Test-Path $exe)) { throw 'SRBMiner-MULTI.exe did not land in ' + $dir }
Say ('installed: {0}  {1:N1} MB  v{2}' -f $exe, ((Get-Item $exe).Length / 1MB), (Get-Item $exe).VersionInfo.FileVersion)
Get-ChildItem $dir -File | Select-Object Name, @{ n = 'MB'; e = { [math]::Round($_.Length / 1MB, 1) } } |
  Format-Table -AutoSize | Out-String | Write-Host
