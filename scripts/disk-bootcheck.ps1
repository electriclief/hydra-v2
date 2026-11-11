# Is this really going to boot? Check the parts firmware looks at, not the files on it.
#   1. the MBR boot code (bytes 0..445) - zero means firmware finds a partition table but no loader
#   2. the 0x55AA signature at the end of the sector
#   3. the boot indicator on the active partition
#   4. the NTFS/FAT boot sector of the active partition, and what it names as loader
param([int]$Disk = 2)

$h = [System.IO.File]::Open("\\.\PhysicalDrive$Disk", 'Open', 'Read', 'ReadWrite')
$mbr = New-Object byte[] 512
$null = $h.Read($mbr, 0, 512)
$h.Dispose()

$code = $mbr[0..445]
$nonZero = @($code | Where-Object { $_ -ne 0 }).Count
'sector 0: {0} of 446 boot-code bytes are non-zero' -f $nonZero
'signature: {0:X2} {1:X2}  (must be 55 AA)' -f $mbr[510], $mbr[511]
'disk signature: {0:X2}{1:X2}{2:X2}{3:X2}' -f $mbr[440], $mbr[441], $mbr[442], $mbr[443]

# first 16 bytes of the loader code are the giveaway: MS boot code starts with a jump and "MSDOS5.0"/"MSWIN4.1"
'boot code bytes 0-15: ' + (($mbr[0..15] | ForEach-Object { '{0:X2}' -f $_ }) -join ' ')
$ascii = -join ($mbr[3..10] | ForEach-Object { [char]$_ })
'OEM name at offset 3: "' + $ascii + '"'

# partition entries
for ($i = 0; $i -lt 4; $i++) {
  $o = 446 + ($i * 16)
  $boot = $mbr[$o]
  $type = $mbr[$o + 4]
  $lba = [BitConverter]::ToUInt32($mbr, $o + 8)
  $sectors = [BitConverter]::ToUInt32($mbr, $o + 12)
  if ($sectors -eq 0) { continue }
  'partition {0}: boot={1} type=0x{2:X2} start_lba={3} sectors={4:N0}' -f ($i + 1), $boot, $type, $lba, $sectors
}

# the VBR of the active partition: does it say BOOTMGR or NTLDR?
$part = Get-Partition -DiskNumber $Disk | Where-Object IsActive | Select-Object -First 1
if ($part) {
  '{0}: active partition, offset {1:N0}' -f $part.DriveLetter, $part.Offset
  $fs = [System.IO.File]::Open("\\.\PhysicalDrive$Disk", 'Open', 'Read', 'ReadWrite')
  $fs.Position = $part.Offset
  $vbr = New-Object byte[] 512
  $null = $fs.Read($vbr, 0, 512)
  $fs.Dispose()
  $vbrAscii = -join ($vbr | ForEach-Object { if ($_ -ge 32 -and $_ -lt 127) { [char]$_ } else { '.' } })
  'VBR signature: {0:X2} {1:X2}' -f $vbr[510], $vbr[511]
  if ($vbrAscii -match 'BOOTMGR') { 'VBR names the loader: BOOTMGR  (correct for Windows setup media)' }
  elseif ($vbrAscii -match 'NTLDR') { 'VBR names the loader: NTLDR  (wrong - that is XP-era)' }
  else { 'VBR does not name BOOTMGR - this partition will not hand over to bootmgr' }
}
