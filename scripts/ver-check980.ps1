$ErrorActionPreference = 'Continue'
'== lolMiner builds on this node'
Get-ChildItem 'C:\AI\miners' -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  $e = Join-Path $_.FullName 'lolMiner.exe'
  if (Test-Path $e) { '  {0,-12} version {1}' -f $_.Name, (Get-Item $e).VersionInfo.FileVersion }
}
'== the 1.76 etchash log (was this already tested?)'
$l = 'C:\AI\logs\lol176-ETCHASH.log'
if (Test-Path $l) {
  '  file: {0}  {1:N0} B  {2}' -f $l, (Get-Item $l).Length, (Get-Item $l).LastWriteTime
  Get-Content $l | Where-Object { $_ -match 'speed|not supported|error|authorized' } | Select-Object -Last 8 | ForEach-Object { '  ' + ($_ -replace '\s+',' ').Trim() }
} else { '  no 1.76 log' }
'== is SRBMiner here (a third opinion on this card)?'
$srb = Get-ChildItem 'C:\AI' -Recurse -Filter 'SRBMiner-MULTI.exe' -ErrorAction SilentlyContinue | Select-Object -First 2
if ($srb) { $srb | ForEach-Object { '  ' + $_.FullName } } else { '  SRBMiner not installed on this node' }
'VER DONE'
