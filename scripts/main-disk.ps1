$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section 'the system disk as Windows sees it'
Get-PhysicalDisk | Where-Object { $_.BusType -ne 'USB' } | ForEach-Object {
  '  {0}  {1}  {2:N1} GB  health={3}  media={4}  serial={5}' -f $_.DeviceId, $_.FriendlyName, ($_.Size/1GB), $_.HealthStatus, $_.MediaType, $_.SerialNumber
  $rc = $_ | Get-StorageReliabilityCounter -ErrorAction SilentlyContinue
  if ($rc) {
    '    wear {0} %   temperature {1} C   power-on {2} h   power cycles {3}   read errors uncorrected {4}   write errors uncorrected {5}' -f $rc.Wear, $rc.Temperature, $rc.PowerOnHours, $rc.PowerCycleCount, $rc.ReadErrorsUncorrected, $rc.WriteErrorsUncorrected
  }
}
Section 'is smartmontools here'
$sc = 'C:\Program Files\smartmontools\bin\smartctl.exe'
if (Test-Path $sc) {
  & $sc --version | Select-Object -First 1 | ForEach-Object { '  ' + $_ }
  Section 'SMART attributes (the SSD wear counters that matter)'
  $out = & $sc -i -H -A -d sat /dev/sda 2>&1
  $out | Select-String -Pattern 'Device Model|Serial|Firmware|User Capacity|Rotation|SMART overall|SMART Health' | ForEach-Object { '  ' + $_.Line.Trim() }
  '  --- key attributes'
  $out | Select-String -Pattern '^\s*(5|9|12|167|169|171|172|173|177|179|181|183|184|187|190|192|194|197|198|199|202|231|233|241|242)\s' | ForEach-Object { '    ' + ($_.Line -replace '\s+',' ').Trim() }
} else { '  smartmontools NOT installed' }
Section 'disk error events (this is what a dying SSD looks like)'
Get-WinEvent -FilterHashtable @{LogName='System'; Id=7,9,11,51,52,98,129,153} -MaxEvents 12 -ErrorAction SilentlyContinue |
  ForEach-Object { '  {0:yyyy-MM-dd HH:mm} id {1,-3} {2}' -f $_.TimeCreated, $_.Id, ((($_.Message -split "`n")[0]) -replace '\s+',' ').Trim().Substring(0, [Math]::Min(120, ((($_.Message -split "`n")[0]) -replace '\s+',' ').Trim().Length)) }
Section 'WHEA / hardware errors (these point at the board, not the disk)'
Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Microsoft-Windows-WHEA-Logger'} -MaxEvents 8 -ErrorAction SilentlyContinue |
  ForEach-Object { '  {0:yyyy-MM-dd HH:mm} id {1}  {2}' -f $_.TimeCreated, $_.Id, ((($_.Message -split "`n")[0]) -replace '\s+',' ').Trim() }
Section 'kernel power: how many unexpected shutdowns, and when'
$kp = @(Get-WinEvent -FilterHashtable @{LogName='System'; Id=41,6008} -MaxEvents 40 -ErrorAction SilentlyContinue)
'  count in this log: {0}' -f $kp.Count
$kp | Select-Object -First 6 | ForEach-Object { '  {0:yyyy-MM-dd HH:mm} id {1}' -f $_.TimeCreated, $_.Id }
Section 'filesystem health'
Get-Volume -DriveLetter C | ForEach-Object { '  {0}: health {1}  repair {2}' -f $_.DriveLetter, $_.HealthStatus, $_.OperationalStatus }
'MAIN DISK PROBE DONE'
