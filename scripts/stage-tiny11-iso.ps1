# Pull the tiny11 ISO off the Ventoy stick, inspect it, and leave it ready to mount.
$ErrorActionPreference = 'Stop'
$src = 'F:\tiny11_25H2_Nov25.iso'
$dstDir = 'E:\AI\iso'
$dst = Join-Path $dstDir 'tiny11_25H2.iso'

New-Item -ItemType Directory -Force $dstDir | Out-Null
if (-not (Test-Path -LiteralPath $dst)) {
  'copying {0:N2} GB from the Ventoy stick...' -f ((Get-Item -LiteralPath $src).Length / 1GB)
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  Copy-Item -LiteralPath $src -Destination $dst -Force
  $sw.Stop()
  'copied in {0:N0} s  ({1:N1} MB/s)' -f $sw.Elapsed.TotalSeconds, (((Get-Item $dst).Length / 1MB) / $sw.Elapsed.TotalSeconds)
} else {
  'already present: ' + $dst
}
'{0}  {1:N2} GB' -f $dst, ((Get-Item -LiteralPath $dst).Length / 1GB)

# ---- what is actually inside it
$img = Mount-DiskImage -ImagePath $dst -PassThru
$vol = Get-Volume -DiskImage $img | Where-Object DriveLetter | Select-Object -First 1
$root = "$($vol.DriveLetter):\"
'--- mounted at ' + $root
'--- root: ' + ((Get-ChildItem -LiteralPath $root -Force | Select-Object -ExpandProperty Name) -join ', ')
'--- sources, the parts that decide whether FAT32 can hold it:'
Get-ChildItem -LiteralPath (Join-Path $root 'sources') -Filter 'install.*' -File |
  Select-Object Name, @{ n = 'GB'; e = { [math]::Round($_.Length / 1GB, 2) } } | Format-Table -AutoSize | Out-String | Write-Host
Get-ChildItem -LiteralPath (Join-Path $root 'sources') -Filter 'boot.*' -File |
  Select-Object Name, @{ n = 'MB'; e = { [math]::Round($_.Length / 1MB, 1) } } | Format-Table -AutoSize | Out-String | Write-Host
$need = @('bootmgr', 'boot\bcd', 'sources\boot.wim', 'efi\boot\bootx64.efi')
foreach ($n in $need) { '{0,-24} {1}' -f $n, (Test-Path -LiteralPath (Join-Path $root $n)) }
'--- total: {0:N2} GB in {1:N0} files' -f ((Get-ChildItem -LiteralPath $root -Recurse -File -Force | Measure-Object Length -Sum).Sum / 1GB), (Get-ChildItem -LiteralPath $root -Recurse -File -Force).Count
Dismount-DiskImage -ImagePath $dst | Out-Null
'dismounted'
