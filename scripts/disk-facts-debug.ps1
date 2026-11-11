# why did disk-facts write 0 reports? print each decision instead of guessing
$ErrorActionPreference = 'Continue'
$ctl = 'C:\Program Files\smartmontools\bin\smartctl.exe'
'== scan'
$scan = & $ctl --scan-open 2>&1
$scan -join "`n"
$devs = @()
foreach ($line in ($scan -join "`n" -split "`n")) {
  if ($line -match '^(/dev/\S+)\s+-d\s+(\S+)') { $devs += [pscustomobject]@{ dev = $matches[1]; type = $matches[2] } }
}
'devs parsed: ' + $devs.Count
'== disks'
Get-Disk | ForEach-Object { '  #{0} {1} {2} bytes {3}' -f $_.Number, $_.FriendlyName, $_.Size, $_.BusType }

foreach ($d in (Get-Disk)) {
  '== PhysicalDrive{0}' -f $d.Number
  foreach ($dv in $devs) {
    $ident = & $ctl -i -d $dv.type $dv.dev 2>&1 | Out-String
    $capLine = ($ident -split "`n" | Where-Object { $_ -match 'Capacity' } | Select-Object -First 1)
    '   {0} cap line: {1}' -f $dv.dev, ($capLine -replace '\s+', ' ')
    $m1 = $ident -match '([\d,]+)\s+bytes'
    '   old pattern (bytes): {0}' -f $m1
    $m2 = $ident -match '([\d,]+)\s+(?:bytes|\[)'
    '   new pattern: {0}   matched={1}' -f $m2, $(if ($m2) { $matches[1] } else { 'none' })
  }
}
