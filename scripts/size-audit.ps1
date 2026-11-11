$ErrorActionPreference = 'Continue'
function DirSize($p) {
  if (-not (Test-Path $p)) { return $null }
  try { $s = (Get-ChildItem $p -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum } catch { $s = 0 }
  if (-not $s) { $s = 0 }
  return [math]::Round($s / 1MB, 1)
}
'' ; '=== C:\AI subdirectories (MB)'
Get-ChildItem 'C:\AI' -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  '  {0,-16} {1,9} MB' -f $_.Name, (DirSize $_.FullName)
}
'' ; '=== the llama pieces'
foreach ($p in 'C:\AI\llama', 'C:\AI\models', 'C:\AI\tools\dl', 'C:\AI\tools\amd2152', 'C:\AI\tools\nv580', 'C:\AI\tools\nv591', 'C:\AI\miners') {
  $s = DirSize $p
  if ($null -ne $s) { '  {0,-24} {1,9} MB' -f $p, $s }
}
'' ; '=== individual big files over 100 MB anywhere in C:\AI'
Get-ChildItem 'C:\AI' -Recurse -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.Length -gt 100MB } |
  Sort-Object Length -Descending | Select-Object -First 20 | ForEach-Object { '  {0,9:N0} MB  {1}' -f ($_.Length / 1MB), $_.FullName }
'' ; '=== other reclaimable'
'  pagefile  : ' + [math]::Round((Get-Item 'C:\pagefile.sys' -Force -ErrorAction SilentlyContinue).Length / 1GB, 2) + ' GB'
'  hiberfil  : ' + [math]::Round((Get-Item 'C:\hiberfil.sys' -Force -ErrorAction SilentlyContinue).Length / 1GB, 2) + ' GB'
'  WU cache  : ' + (DirSize 'C:\Windows\SoftwareDistribution\Download') + ' MB'
'  WinSxS    : ' + (DirSize 'C:\Windows\WinSxS') + ' MB  (never delete by hand)'
'  Temp      : ' + (DirSize 'C:\Windows\Temp') + ' MB'
'  user Temp : ' + (DirSize 'C:\Users\User\AppData\Local\Temp') + ' MB'
'  Downloads : ' + (DirSize 'C:\Users\User\Downloads') + ' MB'
'  pagefile setting: ' + ((Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management').PagingFiles -join '; ')
$v = Get-Volume -DriveLetter C
'  C: used {0:N1} GB  free {1:N1} GB' -f (($v.Size - $v.SizeRemaining) / 1GB), ($v.SizeRemaining / 1GB)
'INVENTORY DONE'
