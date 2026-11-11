# Layout test for make-installer-drive.ps1 - runs against a throwaway VHD, never a real disk.
$ErrorActionPreference = 'Stop'
$work = 'C:\AI\work'
New-Item -ItemType Directory -Force $work | Out-Null
$vhd = Join-Path $work 'installer-test.vhd'

# any leftover from a previous run
$old = Get-Disk | Where-Object { $_.Location -like "*installer-test.vhd*" }
foreach ($o in $old) { Dismount-VHD -DiskNumber $o.Number -ErrorAction SilentlyContinue }
if (Test-Path $vhd) { Remove-Item $vhd -Force }

$dp = Join-Path $work 'dp.txt'
@"
create vdisk file="$vhd" maximum=16384 type=expandable
select vdisk file="$vhd"
attach vdisk
"@ | Out-File -FilePath $dp -Encoding ascii
& diskpart /s $dp | Out-Null
Start-Sleep -Seconds 2

$v = Get-Disk | Where-Object { $_.Location -like '*installer-test.vhd*' } | Select-Object -First 1
if (-not $v) { throw 'the test VHD did not attach' }
'vhd disk    : ' + $v.Number + '  ' + $v.FriendlyName + '  serial "' + $v.SerialNumber + '"  ' + [math]::Round($v.Size / 1GB) + ' GB'

# ---- fake setup media: the right shape, tiny files
$media = Join-Path $work 'fake-media'
if (Test-Path $media) { Remove-Item $media -Recurse -Force }
foreach ($dir in @('boot', 'efi\boot', 'sources')) { New-Item -ItemType Directory -Force (Join-Path $media $dir) | Out-Null }
Set-Content -LiteralPath (Join-Path $media 'bootmgr') -Value 'fake bootmgr'
Set-Content -LiteralPath (Join-Path $media 'boot\bcd') -Value 'fake bcd store'
Set-Content -LiteralPath (Join-Path $media 'efi\boot\bootx64.efi') -Value 'fake efi loader'
Set-Content -LiteralPath (Join-Path $media 'sources\boot.wim') -Value 'fake winpe'
Set-Content -LiteralPath (Join-Path $media 'sources\install.wim') -Value 'fake install image'
Set-Content -LiteralPath (Join-Path $media 'setup.exe') -Value 'fake setup'
$files = Get-ChildItem $media -Recurse -File
'fake media  : {0} files, {1:N0} bytes' -f $files.Count, ($files | Measure-Object Length -Sum).Sum

# ---- plan only first: nothing is touched
'--- plan only'
& powershell -NoProfile -ExecutionPolicy Bypass -File 'C:\Users\User\make-installer-drive.ps1' -Disk $v.Number -Serial $v.SerialNumber -SourceFolder $media -WhatIfLayout

# ---- the real thing, on the VHD
'--- building the layout'
& powershell -NoProfile -ExecutionPolicy Bypass -File 'C:\Users\User\make-installer-drive.ps1' -Disk $v.Number -Serial $v.SerialNumber -SourceFolder $media

# ---- independent look at what came out
'--- independent check'
$parts = Get-Disk -Number $v.Number | Get-Partition
$parts | Select-Object PartitionNumber, DriveLetter, @{ n = 'GB'; e = { [math]::Round($_.Size / 1GB, 2) } }, IsActive, Type | Format-Table -AutoSize | Out-String | Write-Host
foreach ($p in $parts) {
  $letter = "$($p.DriveLetter):"
  if (-not $p.DriveLetter) { continue }
  $vol = Get-Volume -DriveLetter $p.DriveLetter
  '{0}  {1}  {2}  {3:N2} GB used' -f $letter, $vol.FileSystem, $vol.FileSystemLabel, (($vol.Size - $vol.SizeRemaining) / 1GB)
  Get-ChildItem -LiteralPath "$letter\" -Force | Select-Object -ExpandProperty Name | ForEach-Object { '     ' + $_ }
  if (Test-Path "$letter\sources") {
    Get-ChildItem -LiteralPath "$letter\sources" -Force | Select-Object Name, Length | Format-Table -AutoSize | Out-String | Write-Host
  }
}

# ---- wrong serial must be refused, disk untouched
'--- guard test: wrong serial'
try {
  & powershell -NoProfile -ExecutionPolicy Bypass -File 'C:\Users\User\make-installer-drive.ps1' -Disk $v.Number -Serial 'NOT-THIS-DISK' -SourceFolder $media 2>&1 | Select-Object -Last 3
} catch { 'refused: ' + $_.Exception.Message }

# ---- put the test box back
Dismount-VHD -DiskNumber $v.Number
if (Test-Path $vhd) { Remove-Item $vhd -Force }
'vhd detached and deleted'
