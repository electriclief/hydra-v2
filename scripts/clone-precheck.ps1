$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section 'disks and volumes (what an image would have to carry)'
Get-Disk | ForEach-Object { '  disk {0}  {1,-28} {2,-10} {3,8:N1} GB  bus {4}  part {5}' -f $_.Number, $_.FriendlyName, $_.PartitionStyle, ($_.Size / 1GB), $_.BusType, $_.PartitionStyle }
Get-Volume | Where-Object { $_.DriveLetter } | ForEach-Object { '  {0}: {1,-12} {2,8:N1} GB free  fs {3}' -f $_.DriveLetter, $_.FileSystemLabel, ($_.SizeRemaining / 1GB), $_.FileSystemType }
Section 'is the volume encrypted (a clone needs the key)'
try { Get-BitLockerVolume -ErrorAction Stop | ForEach-Object { '  {0}: {1}' -f $_.MountPoint, $_.ProtectionStatus } } catch { '  no BitLocker cmdlets / not encrypted' }
Section 'Windows activation'
& cscript //nologo C:\Windows\System32\slmgr.vbs /xpr 2>&1 | ForEach-Object { '  ' + $_.Trim() }
Section 'edition and build'
Get-CimInstance Win32_OperatingSystem | ForEach-Object { '  {0}  build {1}  {2}' -f $_.Caption, $_.BuildNumber, $_.Version }
Section 'machine identity that a clone would duplicate'
'  hostname: ' + $env:COMPUTERNAME
'  machine guid: ' + (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid).MachineGuid
'  product id: ' + (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -Name ProductId).ProductId
Section 'ssh host keys (must be regenerated on every clone)'
Get-ChildItem 'C:\ProgramData\ssh\ssh_host_*' -ErrorAction SilentlyContinue | ForEach-Object { '  {0}  {1:N0} B' -f $_.Name, $_.Length }
Section 'what already works and would be cloned'
'  TdrDelay: ' + (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers' -Name TdrDelay -ErrorAction SilentlyContinue).TdrDelay
'  pagefile : ' + ((Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management').PagingFiles -join '; ')
'  auto-logon: ' + (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -Name AutoAdminLogon -ErrorAction SilentlyContinue).AutoAdminLogon
'  mining task: ' + (Get-ScheduledTask -TaskName 'HydraMine1' -ErrorAction SilentlyContinue).State
'  defender exclusions: ' + (((Get-MpPreference).ExclusionPath) -join ' | ')
'  drivers: NVIDIA ' + ((Get-CimInstance Win32_VideoController | Where-Object Name -match 'NVIDIA' | Select-Object -First 1).DriverVersion) + '  AMD ' + ((Get-CimInstance Win32_VideoController | Where-Object Name -match 'Radeon' | Select-Object -First 1).DriverVersion)
'CLONE-PRECHECK DONE'
