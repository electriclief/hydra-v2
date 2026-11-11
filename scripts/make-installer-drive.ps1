# Turn a keeper drive into a bootable tiny11 installer, instead of just wiping it.
#
#   Layout it builds (MBR, so it boots on both UEFI and legacy BIOS):
#     partition 1  FAT32, active   the setup media  - bootmgr, \boot, \efi\boot, \sources
#     partition 2  NTFS, rest      DATA             - so the drive is still useful afterwards
#
#   It refuses to touch the running system disk, and it refuses to touch any disk whose serial
#   does not match -Serial. That second guard is the whole point: disk numbers shuffle when drives
#   are plugged and unplugged, and this script destroys whatever it is pointed at.
#
#   powershell -File make-installer-drive.ps1 -Disk 2 -Serial WCC3FD40HYFF -Iso D:\tiny11.iso
#   powershell -File make-installer-drive.ps1 -Disk 2 -Serial WCC3FD40HYFF -Iso D:\tiny11.iso -NoDataPartition
#   powershell -File make-installer-drive.ps1 -Disk 2 -Serial TEST -SourceFolder C:\fake-media -WhatIfLayout
param(
  [Parameter(Mandatory = $true)][int]$Disk,
  [string]$Serial = '',
  [switch]$NoSerialCheck,       # tests only: a virtual disk reports no serial at all
  [string]$Iso = '',
  [string]$SourceFolder = '',
  [switch]$NoDataPartition,
  [switch]$InstallTarget,       # partition 2 is a formatted NTFS target for setup, not a DATA scratch volume
  [switch]$WhatIfLayout,        # build the partition table and copy, but stop before formatting? (kept for tests)
  [switch]$Force,               # proceed even if the media looks incomplete
  [string]$Label = 'TINY11',
  [string]$DataLabel = 'DATA'
)

$ErrorActionPreference = 'Stop'
function Say($t) { Write-Host $t }

# ---------- 1. guards -------------------------------------------------------
$d = Get-Disk -Number $Disk -ErrorAction Stop
if ($d.IsSystem -or $d.IsBoot) { throw "REFUSING: disk $Disk ($($d.FriendlyName)) is the running system disk." }
# The serial printed on the label is the DRIVE's serial. A USB-SATA bridge reports its own serial in the
# disk object and gives the same one for every drive plugged into it, so that number is worthless as a guard.
# Read the drive's own identity out of SMART instead, and accept the disk-object serial only as a fallback.
function Get-SmartIdentity {
  param([int]$Number)
  $ctl = 'C:\Program Files\smartmontools\bin\smartctl.exe'
  if (-not (Test-Path -LiteralPath $ctl)) { return $null }
  $diskSize = [int64](Get-Disk -Number $Number).Size
  $scan = @(& $ctl --scan-open 2>$null)
  foreach ($line in $scan) {
    if ($line -notmatch '^(/dev/sd[a-z])') { continue }
    $devPath = $matches[1]
    $info = @(& $ctl -i -d auto $devPath 2>$null)
    $capNum = $null
    $capLine = ($info | Where-Object { $_ -match '^User Capacity' } | Select-Object -First 1)
    if ($capLine -and ($capLine -match 'User Capacity:[^0-9]*([0-9,]{6,})')) {
      $capNum = [int64](($matches[1]) -replace ',', '')
    }
    if (-not $capNum) { continue }
    if ([math]::Abs($capNum - $diskSize) -gt 50MB) { continue }
    $model = (($info | Where-Object { $_ -match '^(Device Model|Model Number):' } | Select-Object -First 1) -replace '^[^:]+:\s*', '')
    $ser = (($info | Where-Object { $_ -match '^Serial Number:' } | Select-Object -First 1) -replace '^[^:]+:\s*', '')
    return [pscustomobject]@{
      dev    = $devPath
      model  = ([string]$model).Trim()
      serial = ([string]$ser).Trim()
    }
  }
  return $null
}

$ident = Get-SmartIdentity -Number $Disk
$diskSerial = [string]$d.SerialNumber
if ($ident) { Say ("drive identity (SMART): {0}  serial {1}  on {2}" -f $ident.model, $ident.serial, $ident.dev) }
else { Say ("drive identity (SMART): not readable through this bridge - falling back to the disk object serial") }

if ($NoSerialCheck) {
  Say 'WARNING: -NoSerialCheck - the serial guard is off for this run.'
} elseif (-not $Serial.Trim()) {
  throw "REFUSING: pass -Serial <the serial on the drive's label>. SMART says '$(if ($ident) { $ident.serial } else { 'unreadable' })', disk object says '$diskSerial'. Nothing was changed."
} else {
  $want = $Serial.Trim()
  $hit = ($ident -and $ident.serial -eq $want) -or ($diskSerial -eq $want)
  if (-not $hit) {
    throw "REFUSING: this drive is not the one named. SMART serial '$(if ($ident) { $ident.serial } else { 'unreadable' })', disk object serial '$diskSerial', you said '$want'. Nothing was changed."
  }
  Say ("serial confirmed: $want" + $(if ($ident -and $ident.serial -eq $want) { ' (read from the drive itself)' } else { ' (bridge serial - SMART serial unreadable)' }))
}
# a Ventoy stick must never be a target: it holds the images we are copying FROM
$labels = @(Get-Partition -DiskNumber $Disk -ErrorAction SilentlyContinue | ForEach-Object {
  (Get-Volume -Partition $_ -ErrorAction SilentlyContinue).FileSystemLabel
})
if ($labels -match 'VENTOY|VTOYEFI') { throw "REFUSING: disk $Disk carries a Ventoy volume ($($labels -join ', ')) - that is the source media, not a target." }
if (-not $NoSerialCheck) {
  $isos = @(Get-Partition -DiskNumber $Disk -ErrorAction SilentlyContinue | Where-Object DriveLetter | ForEach-Object {
    Get-ChildItem -LiteralPath "$($_.DriveLetter):\" -Filter '*.iso' -File -ErrorAction SilentlyContinue
  })
  if ($isos.Count) { throw ("REFUSING: disk $Disk holds {0} ISO file(s) at the root ({1}) - looks like install media, not a blank keeper." -f $isos.Count, (($isos | Select-Object -First 3 -ExpandProperty Name) -join ', ')) }
}
Say ("target disk {0}: {1}  serial {2}  {3:N0} GB  {4}  {5}" -f $d.Number, $d.FriendlyName, $d.SerialNumber, ($d.Size / 1GB), $d.BusType, $d.PartitionStyle)

# ---------- 2. source media -------------------------------------------------
$mountedImage = $null
$root = $null
if ($Iso) {
  if (-not (Test-Path -LiteralPath $Iso)) { throw "no such ISO: $Iso" }
  $mountedImage = Mount-DiskImage -ImagePath $Iso -PassThru
  $vol = Get-Volume -DiskImage $mountedImage | Where-Object { $_.DriveLetter } | Select-Object -First 1
  if (-not $vol) { throw "the ISO mounted but has no drive letter" }
  $root = "$($vol.DriveLetter):\"
} elseif ($SourceFolder) {
  if (-not (Test-Path -LiteralPath $SourceFolder)) { throw "no such folder: $SourceFolder" }
  $root = (Resolve-Path -LiteralPath $SourceFolder).Path.TrimEnd('\') + '\'
} else {
  throw 'give -Iso <file.iso> or -SourceFolder <dir>'
}
Say "source: $root"

$files = @(Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction SilentlyContinue)
$totalBytes = ($files | Measure-Object Length -Sum).Sum
Say ("source files: {0:N0}   {1:N2} GB" -f $files.Count, ($totalBytes / 1GB))

# what makes it a *bootable* Windows installer, as opposed to a folder of files
$needed = @('bootmgr', 'boot\bcd', 'sources\boot.wim', 'efi\boot\bootx64.efi')
$missing = @($needed | Where-Object { -not (Test-Path -LiteralPath (Join-Path $root $_)) })
if ($missing.Count -and -not $Force) {
  throw ("media is missing {0} - this is not a bootable Windows setup. Use -Force to build it anyway." -f ($missing -join ', '))
}

# FAT32 cannot hold a 4 GB file, and install.wim is usually the one that gets close
$fat32Limit = 4GB - 64MB
$tooBig = @($files | Where-Object { $_.Length -gt $fat32Limit })
foreach ($f in $tooBig) { Say ("  over the FAT32 limit ({0:N2} GB): {1}" -f ($f.Length / 1GB), $f.FullName.Substring($root.Length)) }

# a single file past 4 GB cannot exist on FAT32. The only file that ever gets there is install.wim, and the
# supported fix is a split image: setup.exe looks for install.swm on its own. ESD cannot be split - if that is
# what the media carries, say so instead of copying 60% of a file and calling it done.
$oversizeWim = @($tooBig | Where-Object { $_.Name -eq 'install.wim' })
$oversizeOther = @($tooBig | Where-Object { $_.Name -ne 'install.wim' })
if ($oversizeOther.Count) {
  throw ("these files are over 4 GB and FAT32 cannot hold them: {0}. Use a media set with a split install.wim." -f (($oversizeOther | ForEach-Object { $_.Name }) -join ', '))
}
$splitNeeded = [bool]($oversizeWim.Count)
if ($splitNeeded) { Say '  install.wim will be split into install.swm after the copy (dism /Split-Image)' }

# ---------- 3. plan the layout ---------------------------------------------
$bootSize = [int64](($totalBytes * 1.15) + 300MB)
$bootSize = [math]::Max($bootSize, 6GB)                      # room for a second image later
if ($NoDataPartition) {
  $bootSize = [int64]$d.Size - 1MB                           # one partition, the whole disk
} else {
  $cap = [int64]$d.Size - 2GB                                # always leave a usable DATA partition
  if ($bootSize -gt $cap) { $bootSize = $cap }
  if ($bootSize -lt 1GB) { throw ("disk is too small for a {0:N1} GB media set plus a data partition" -f ($totalBytes / 1GB)) }
}
$align = 1MB
$bootSize = [int64]([math]::Floor($bootSize / $align) * $align)
$second = if ($InstallTarget) { "  +  P2 NTFS {0:N1} GB (WINDOWS - the install target, same disk)" -f (($d.Size - $bootSize) / 1GB) }
          elseif ($NoDataPartition) { '' }
          else { "  +  P2 NTFS {0:N1} GB (DATA)" -f (($d.Size - $bootSize) / 1GB) }
Say ("plan: {0} MBR  ->  P1 FAT32 {1:N1} GB (active, setup media){2}" -f $Disk, ($bootSize / 1GB), $second)

if ($WhatIfLayout) { Say 'WHATIF: nothing was changed.'; if ($mountedImage) { Dismount-DiskImage -ImagePath $Iso | Out-Null }; return }

# ---------- 4. wipe and lay it out -----------------------------------------
Say 'wiping...'
# Clear-Disk refuses outright on a disk that was never initialised ("The disk has not been initialized"),
# and Initialize-Disk refuses on one that is already MBR - so ask each time instead of assuming
if ((Get-Disk -Number $Disk).PartitionStyle -ne 'RAW') {
  Clear-Disk -Number $Disk -RemoveData -RemoveOEM -Confirm:$false
} else {
  Say '  disk is already uninitialised - nothing to clear'
}
if ((Get-Disk -Number $Disk).PartitionStyle -ne 'MBR') {
  Initialize-Disk -Number $Disk -PartitionStyle MBR -Confirm:$false
}

$bootPart = New-Partition -DiskNumber $Disk -Size $bootSize -IsActive -AssignDriveLetter
$bootVol = Format-Volume -Partition $bootPart -FileSystem FAT32 -NewFileSystemLabel $Label -Confirm:$false -Force
Say ("boot partition: {0}:  {1}  {2:N1} GB" -f $bootPart.DriveLetter, $bootVol.FileSystem, ($bootVol.Size / 1GB))

# ---------- 5. copy the setup media ----------------------------------------
Say 'copying setup media...'
$dest = "$($bootPart.DriveLetter):\"
# call it directly, not through Start-Process: Start-Process re-joins the arguments and paths with spaces
# (and the trailing backslash of a drive root) arrive mangled - "No Destination Directory Specified"
$copyArgs = @($root, $dest, '/E', '/COPY:DAT', '/DCOPY:T', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NP')
if ($splitNeeded) { $copyArgs += @('/XF', 'install.wim') }
& robocopy.exe @copyArgs | Out-Null
$copyExit = $LASTEXITCODE
# robocopy: 0-7 mean success, 8+ mean at least one file failed
if ($copyExit -ge 8) { throw "robocopy failed with exit code $copyExit" }
Say "copied (robocopy exit $copyExit)"

if ($splitNeeded) {
  Say 'splitting install.wim into 3800 MB chunks...'
  $srcWim = Join-Path $root 'sources\install.wim'
  $swmDir = Join-Path $dest 'sources'
  $dism = Join-Path $env:SystemRoot 'System32\dism.exe'
  & $dism /Split-Image /ImageFile:$srcWim /SWMFile:"$swmDir\install.swm" /FileSize:3800 /Quiet
  if ($LASTEXITCODE -ne 0) { throw "dism /Split-Image failed with exit code $LASTEXITCODE - the media is NOT usable" }
  Say '  split done'
}

# ---------- 5b. firmware boot code -----------------------------------------
# Creating partitions gives a valid table but says nothing about the loader. Legacy BIOS reads the 446 bytes
# at sector 0 and hands to the active partition's boot sector, so those must be written explicitly: bootsect
# ships on the media and writes NT60 code to both the MBR and the volume boot record.
$bootsect = Join-Path $root 'boot\bootsect.exe'
if (Test-Path -LiteralPath $bootsect) {
  & $bootsect /nt60 "$($bootPart.DriveLetter):" /mbr /force | Out-Null
  if ($LASTEXITCODE -ne 0) { Say ("  WARNING: bootsect exited $LASTEXITCODE - boot code may not be written") }
  else { Say '  boot code written (/nt60 /mbr)' }
} else {
  Say '  WARNING: bootsect.exe is not on this media - firmware boot code was not refreshed'
}

# ---------- 6. the second partition ----------------------------------------
if ($InstallTarget) {
  # setup wants a formatted NTFS volume it can write Windows into. Pre-making it means no diskpart at the
  # setup screen and no chance of picking the media partition by mistake.
  $winPart = New-Partition -DiskNumber $Disk -UseMaximumSize -AssignDriveLetter
  $winVol = Format-Volume -Partition $winPart -FileSystem NTFS -NewFileSystemLabel 'WINDOWS' -Confirm:$false -Force
  Say ("windows target: {0}:  {1}  {2:N1} GB  -  in setup, choose Disk 0 Partition 2" -f $winPart.DriveLetter, $winVol.FileSystem, ($winVol.Size / 1GB))
} elseif (-not $NoDataPartition) {
  $free = Get-Disk -Number $Disk | Get-Partition | Where-Object { -not $_.DriveLetter }
  $dataPart = New-Partition -DiskNumber $Disk -UseMaximumSize -AssignDriveLetter
  $dataVol = Format-Volume -Partition $dataPart -FileSystem NTFS -NewFileSystemLabel $DataLabel -Confirm:$false -Force
  Say ("data partition: {0}:  {1}  {2:N1} GB" -f $dataPart.DriveLetter, $dataVol.FileSystem, ($dataVol.Size / 1GB))
}

# ---------- 7. prove it, do not assume it -----------------------------------
$checks = [ordered]@{
  'bootmgr'                 = Test-Path -LiteralPath (Join-Path $dest 'bootmgr')
  'boot\bcd'                = Test-Path -LiteralPath (Join-Path $dest 'boot\bcd')
  'sources\boot.wim'        = Test-Path -LiteralPath (Join-Path $dest 'sources\boot.wim')
  'efi\boot\bootx64.efi'    = Test-Path -LiteralPath (Join-Path $dest 'efi\boot\bootx64.efi')
  'sources\install.(wim|esd|swm)' = [bool](Get-ChildItem -LiteralPath (Join-Path $dest 'sources') -Filter 'install.*' -ErrorAction SilentlyContinue)
}
$rows = foreach ($k in $checks.Keys) { [pscustomobject]@{ file = $k; present = $checks[$k] } }
$rows | Format-Table -AutoSize | Out-String | Write-Host

$part = Get-Disk -Number $Disk | Get-Partition | Select-Object PartitionNumber, DriveLetter, @{n = 'GB'; e = { [math]::Round($_.Size / 1GB, 1) } }, IsActive, Type
$part | Format-Table -AutoSize | Out-String | Write-Host

if ($mountedImage) { Dismount-DiskImage -ImagePath $Iso | Out-Null }

$bad = @($rows | Where-Object { -not $_.present })
if ($bad.Count) { throw ("BUILT, BUT NOT BOOTABLE: missing {0}" -f (($bad | ForEach-Object { $_.file }) -join ', ')) }
Say 'DONE - the drive carries a bootable setup. Boot the target machine from it (F12 boot menu, pick the USB/disk).'
Say 'Note: on a UEFI machine the disk must be in the boot list - a USB-SATA bridge may not appear; an internal bay is safest.'
