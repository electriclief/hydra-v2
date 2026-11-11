# A drive that does not appear: is it the disk, the bridge, or the power?
$ErrorActionPreference = 'Continue'
$ctl = 'C:\Program Files\smartmontools\bin\smartctl.exe'

'== disks windows has'
Get-Disk | Select-Object Number, FriendlyName, SerialNumber, @{n='GB';e={[math]::Round($_.Size/1GB,1)}}, BusType, PartitionStyle, OperationalStatus | Format-Table -AutoSize | Out-String

'== disk devices the PnP layer sees (a bridge with no media still shows here)'
Get-PnpDevice -Class DiskDrive -ErrorAction SilentlyContinue | Select-Object Status, FriendlyName, InstanceId | Format-Table -AutoSize | Out-String -Width 200

'== usb mass storage + storage controllers'
Get-PnpDevice -Class USB -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -match 'Mass|Storage|SATA|Bridge' } | Select-Object Status, FriendlyName | Format-Table -AutoSize | Out-String

'== smartctl scan (open)'
& $ctl --scan-open 2>&1 | Out-String

'== smartctl scan without opening - shows devices even when the OS has no disk for them'
& $ctl --scan 2>&1 | Out-String

'== any physical drive with no disk object (raw device nodes)'
foreach ($n in 0..5) {
  $ok = Test-Path ("\\.\PhysicalDrive{0}" -f $n)
  '  \\.\PhysicalDrive{0} present: {1}' -f $n, $ok
}

'== recent storage errors in the event log (last 20 min)'
Get-WinEvent -FilterHashtable @{ LogName = 'System'; StartTime = (Get-Date).AddMinutes(-20) } -ErrorAction SilentlyContinue |
  Where-Object { $_.ProviderName -match 'disk|stor|usb|volmgr|Ntfs' } |
  Select-Object -First 10 TimeCreated, ProviderName, Id, @{n='msg';e={($_.Message -split "`n")[0]}} |
  Format-Table -AutoSize | Out-String -Width 200
