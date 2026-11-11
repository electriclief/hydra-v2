# Find a Windows install image on whatever is plugged in, and say what it is.
# Read-only. Prints the ISO path, size, and what is inside it (install.wim vs install.esd, and whether it
# will need splitting for FAT32).
$ErrorActionPreference = 'Continue'

'--- volumes'
Get-Volume | Where-Object { $_.DriveLetter -and $_.DriveType -ne 'Unknown' } |
  Select-Object DriveLetter, FileSystemLabel, FileSystem, DriveType,
    @{ n = 'GB'; e = { [math]::Round($_.Size / 1GB, 1) } },
    @{ n = 'free_GB'; e = { [math]::Round($_.SizeRemaining / 1GB, 1) } } |
  Format-Table -AutoSize | Out-String -Width 120 | Write-Host

'--- ISO files (root of each letter, plus one level down - Ventoy keeps them at the root)'
$isos = @()
foreach ($v in (Get-Volume | Where-Object DriveLetter)) {
  $l = "$($v.DriveLetter):"
  foreach ($dir in @("$l\", "$l\ISO\", "$l\isos\", "$l\images\")) {
    if (Test-Path -LiteralPath $dir) {
      $isos += Get-ChildItem -LiteralPath $dir -Filter '*.iso' -File -ErrorAction SilentlyContinue
    }
  }
}
if (-not $isos.Count) {
  'none found on any mounted volume'
} else {
  $isos | Sort-Object Length -Descending |
    Select-Object @{ n = 'GB'; e = { [math]::Round($_.Length / 1GB, 2) } }, LastWriteTime, FullName |
    Format-Table -AutoSize | Out-String -Width 160 | Write-Host
}

'--- other big files that might be a wim/esd, in case the stick carries no ISO'
foreach ($v in (Get-Volume | Where-Object DriveLetter)) {
  Get-ChildItem -LiteralPath "$($v.DriveLetter):\" -Filter '*.esd' -File -ErrorAction SilentlyContinue |
    Select-Object FullName, @{ n = 'GB'; e = { [math]::Round($_.Length / 1GB, 2) } } |
    Format-Table -AutoSize | Out-String -Width 160 | Write-Host
}
