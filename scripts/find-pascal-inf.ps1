# Which INF in the 582.66 unpack actually carries the GTX 1050 Ti (DEV_1C82), and where the display INFs live.
$ErrorActionPreference = 'Continue'
$root = 'C:\AI\tools\nv582'
'root exists : ' + (Test-Path $root)
$all = @(Get-ChildItem $root -Recurse -Filter '*.inf' -ErrorAction SilentlyContinue)
'inf files   : {0}' -f $all.Count
'--- INFs that mention DEV_1C82 (GTX 1050 Ti)'
foreach ($f in $all) {
  try { if (Select-String -Path $f.FullName -Pattern 'DEV_1C82' -SimpleMatch -Quiet) { '  ' + $f.FullName } } catch { }
}
'--- display-class INFs by name'
($all | Where-Object { $_.Name -match '(?i)^nv.*\.inf$' } | Select-Object -ExpandProperty Name | Sort-Object) -join ', '
'--- subdirectories'
Get-ChildItem $root -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name
