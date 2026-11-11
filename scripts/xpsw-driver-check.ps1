# Did the driver change under us? The card ran 19.3 Mh/s for 58 minutes this morning and now falls to idle clocks after
# 40 seconds. Before blaming the hardware, read what package is bound now and when it arrived.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section '1. the bound display driver'
Get-CimInstance Win32_VideoController | ForEach-Object { '  {0}  driver {1}  date {2}  status {3}' -f $_.Name, $_.DriverVersion, $_.DriverDate, $_.Status }
Section '2. display driver packages on disk (oemN.inf), newest last'
Get-WindowsDriver -Online -ErrorAction SilentlyContinue | Where-Object { $_.ClassName -eq 'Display' } |
  Sort-Object Date | ForEach-Object { '  {0,-12} {1,-22} {2}  original={3}' -f $_.Driver, $_.Version, $_.Date, $_.OriginalFileName }
Section '3. when was anything display-related installed'
$evts = Get-WinEvent -FilterHashtable @{LogName='System'; Id=20001,20003,7045,1074,6005,6008} -MaxEvents 40 -ErrorAction SilentlyContinue |
  Where-Object { $_.Message -match 'nvidia|nvlddmkm|Display|driver' } | Select-Object -First 10
foreach ($e in $evts) {
  $line = (($e.Message -split "`n")[0] -replace '\s+', ' ').Trim()
  if ($line.Length -gt 90) { $line = $line.Substring(0, 90) }
  '  {0:MM-dd HH:mm} id {1}  {2}' -f $e.TimeCreated, $e.Id, $line
}
Section '4. nvidia driver files timestamps'
Get-ChildItem 'C:\Windows\System32\DriverStore\FileRepository' -Directory -Filter 'nv_disp*' -ErrorAction SilentlyContinue | ForEach-Object { '  {0}  created {1}' -f $_.Name, $_.CreationTime }
Section '5. what lolMiner itself says about the driver + card'
Get-Content 'C:\AI\logs\lolminer-session0.log' -TotalCount 6 -ErrorAction SilentlyContinue | ForEach-Object { '  ' + ($_ -replace '\s+',' ').Trim() }
'XPSW DRIVER CHECK DONE'
