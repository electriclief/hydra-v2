# Is the stuck-looking install actually progressing? DriverStore growth over 30 s plus pnputil CPU time is the evidence.
$ErrorActionPreference = 'Continue'
function StoreSize {
  $d = 'C:\Windows\System32\DriverStore\FileRepository'
  $dirs = @(Get-ChildItem $d -Directory -Filter 'nv*' -ErrorAction SilentlyContinue)
  $sum = 0
  foreach ($x in $dirs) { $sum += (Get-ChildItem $x.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum }
  [pscustomobject]@{ dirs = $dirs.Count; GB = [math]::Round($sum / 1GB, 2); newest = ($dirs | Sort-Object LastWriteTime -Descending | Select-Object -First 1).Name }
}
$a = StoreSize
'  t0 : {0} nv dirs · {1} GB · newest {2}' -f $a.dirs, $a.GB, $a.newest
foreach ($p in @(Get-Process pnputil, DrvInst, drvinst -ErrorAction SilentlyContinue)) { '  {0} pid {1} cpu {2:N0}s' -f $p.ProcessName, $p.Id, $p.CPU }
Start-Sleep -Seconds 30
$b = StoreSize
'  t30: {0} nv dirs · {1} GB · newest {2}' -f $b.dirs, $b.GB, $b.newest
foreach ($p in @(Get-Process pnputil, DrvInst, drvinst -ErrorAction SilentlyContinue)) { '  {0} pid {1} cpu {2:N0}s' -f $p.ProcessName, $p.Id, $p.CPU }
'  growth: {0} GB' -f [math]::Round($b.GB - $a.GB, 2)
'--- free space'
Get-PSDrive C | ForEach-Object { '  free {0:N1} GB' -f ($_.Free / 1GB) }
