# Read back what is actually on the built installer drive.
$media = Get-Volume | Where-Object { $_.FileSystemLabel -eq 'TINY11' } | Select-Object -First 1
$target = Get-Volume | Where-Object { $_.FileSystemLabel -eq 'WINDOWS' } | Select-Object -First 1
if (-not $media) { throw 'no partition labelled TINY11' }
'media  : {0}:  {1}  {2:N1} GB  {3:N1} GB free' -f $media.DriveLetter, $media.FileSystem, ($media.Size / 1GB), ($media.SizeRemaining / 1GB)
if ($target) { 'target : {0}:  {1}  {2:N1} GB  label {3}  (empty: {4})' -f $target.DriveLetter, $target.FileSystem, ($target.Size / 1GB), $target.FileSystemLabel, ($target.SizeRemaining -gt ($target.Size - 100MB)) }

$root = "$($media.DriveLetter):\"
'install image:'
Get-ChildItem -LiteralPath "$root\sources" -Filter 'install.*' | Select-Object Name, @{ n = 'GB'; e = { [math]::Round($_.Length / 1GB, 2) } } | Format-Table -AutoSize | Out-String | Write-Host
'boot pieces:'
foreach ($n in @('bootmgr', 'boot\bcd', 'sources\boot.wim', 'efi\boot\bootx64.efi', 'setup.exe')) {
  '  {0,-24} {1}' -f $n, (Test-Path -LiteralPath (Join-Path $root $n))
}
'total: {0:N2} GB in {1:N0} files' -f ((Get-ChildItem -LiteralPath $root -Recurse -File -Force | Measure-Object Length -Sum).Sum / 1GB), (Get-ChildItem -LiteralPath $root -Recurse -File -Force).Count
