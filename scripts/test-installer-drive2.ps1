# Layout test for make-installer-drive.ps1 - runs against a throwaway VHD, never a real disk.
$ErrorActionPreference = 'Stop'
$script = 'C:\Users\User\make-installer-drive.ps1'
$work = 'C:\AI\work'
New-Item -ItemType Directory -Force $work | Out-Null
$vhd = Join-Path $work 'installer-test2.vhd'
$dp = Join-Path $work 'dp.txt'

function Run-Diskpart([string]$body) {
  $body | Out-File -FilePath $dp -Encoding ascii
  & diskpart /s $dp | Out-Null
}

# ---- fresh VHD
if (Test-Path $vhd) { Remove-Item $vhd -Force }
Run-Diskpart "create vdisk file=`"$vhd`" maximum=16384 type=expandable`nselect vdisk file=`"$vhd`"`nattach vdisk"
Start-Sleep -Seconds 2

$v = Get-Disk | Where-Object { $_.Location -like '*installer-test2.vhd*' } | Select-Object -First 1
if (-not $v) { throw 'the test VHD did not attach' }
'vhd disk    : {0}  {1}  serial "{2}"  {3} GB' -f $v.Number, $v.FriendlyName, $v.SerialNumber, [math]::Round($v.Size / 1GB)

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

try {
  '--- plan only'
  & $script -Disk $v.Number -NoSerialCheck -SourceFolder $media -WhatIfLayout

  '--- building the layout'
  & $script -Disk $v.Number -NoSerialCheck -SourceFolder $media
} catch {
  'FAILED: ' + $_.Exception.Message
}

'--- independent check'
$parts = Get-Disk -Number $v.Number | Get-Partition
$parts | Select-Object PartitionNumber, DriveLetter, @{ n = 'GB'; e = { [math]::Round($_.Size / 1GB, 2) } }, IsActive, Type | Format-Table -AutoSize | Out-String | Write-Host
foreach ($p in $parts) {
  if (-not $p.DriveLetter) { continue }
  $letter = "$($p.DriveLetter):"
  $vol = Get-Volume -DriveLetter $p.DriveLetter
  '{0}  {1}  {2}  {3:N2} GB used' -f $letter, $vol.FileSystem, $vol.FileSystemLabel, (($vol.Size - $vol.SizeRemaining) / 1GB)
  Get-ChildItem -LiteralPath "$letter\" -Force | ForEach-Object { '     ' + $_.Name }
  if (Test-Path "$letter\sources") { '     sources: ' + ((Get-ChildItem -LiteralPath "$letter\sources" -Force | Select-Object -ExpandProperty Name) -join ', ') }
}

'--- guard test: wrong serial'
try { & $script -Disk $v.Number -Serial 'NOT-THIS-DISK' -SourceFolder $media } catch { 'refused: ' + $_.Exception.Message }

'--- guard test: the running system disk'
$sys = Get-Disk | Where-Object IsSystem | Select-Object -First 1
try { & $script -Disk $sys.Number -Serial $sys.SerialNumber -SourceFolder $media } catch { 'refused: ' + $_.Exception.Message }

# ---- put the test box back
Run-Diskpart "select vdisk file=`"$vhd`"`ndetach vdisk"
if (Test-Path $vhd) { Remove-Item $vhd -Force }
'vhd detached and deleted'
