# =====================================================================================
#  INSPECT-DRIVES - what storage is in this box right now, and did the added drive show up?
#
#  Reads only. Answers three questions in order: is it seen at all (disk), did it get a letter (volume/partition), and can
#  anything be read from it (filesystem). Those are three different failures and it is worth knowing which one you have
#  before touching anything.
# =====================================================================================
$ErrorActionPreference = 'Continue'

"boot: " + (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToString('yyyy-MM-dd HH:mm:ss')
"now : " + (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
''
'=== disks (the hardware Windows can see)'
Get-Disk | ForEach-Object {
  $d = $_
  $parts = Get-Partition -DiskNumber $d.Number -ErrorAction SilentlyContinue
  $letters = ($parts | Where-Object DriveLetter | ForEach-Object { $_.DriveLetter + ':' }) -join ' '
  '  disk {0}  {1,7:N1} GB  {2,-12} {3,-4} bus {4,-6}  partitions {5}  letters {6}' -f `
    $d.Number, ($d.Size / 1GB), $d.FriendlyName, $d.OperationalStatus, $d.BusType, @($parts).Count, $(if ($letters) { $letters } else { '(none)' })
}
''
'=== volumes with a letter'
Get-Volume | Where-Object DriveLetter | ForEach-Object {
  '  {0}:  {1,-16} {2,-6} {3,8:N1} GB  free {4,7:N1} GB  {5}' -f `
    $_.DriveLetter, $(if ($_.FileSystemLabel) { $_.FileSystemLabel } else { '(no label)' }), $_.FileSystem, ($_.Size / 1GB), ($_.SizeRemaining / 1GB), $_.HealthStatus
}
''
'=== partitions WITHOUT a letter (seen, but nothing can reach them yet)'
$none = Get-Partition | Where-Object { -not $_.DriveLetter -and $_.Type -ne 'Reserved' -and $_.Type -ne 'Recovery' }
if (-not $none) { '  none' } else {
  $none | ForEach-Object { '  disk {0} part {1}  {2,7:N1} GB  type {3}' -f $_.DiskNumber, $_.PartitionNumber, ($_.Size / 1GB), $_.Type }
}
''
'=== raw / unsupported filesystems (a disk that is seen but unreadable)'
$raw = Get-Volume | Where-Object { $_.FileSystemType -in @('RAW', 'Unknown', '') -and $_.DriveType -ne 'CD-ROM' }
if (-not $raw) { '  none' } else {
  $raw | ForEach-Object { '  {0}:  fs {1}  {2:N1} GB  health {3}' -f $_.DriveLetter, $_.FileSystemType, ($_.Size / 1GB), $_.HealthStatus }
}
''
'=== bus view (SATA vs USB matters: a USB enclosure that drops out looks like a dead drive)'
Get-CimInstance Win32_DiskDrive | ForEach-Object {
  '  {0}  {1,8:N1} GB  {2}  serial {3}  status {4}' -f $_.Model, ($_.Size / 1GB), $_.InterfaceType, $_.SerialNumber.Trim(), $_.Status
}
''
'=== would Windows want to chkdsk anything right now?'
$dirty = & fsutil dirty query C: 2>&1
'  C: ' + ($dirty -join ' ')
foreach ($v in (Get-Volume | Where-Object { $_.DriveLetter -and $_.DriveLetter -ne 'C' })) {
  $q = & fsutil dirty query ($v.DriveLetter + ':') 2>&1
  '  ' + $v.DriveLetter + ': ' + ($q -join ' ')
}
