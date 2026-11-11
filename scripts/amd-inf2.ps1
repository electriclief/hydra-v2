$ErrorActionPreference = 'Continue'
$p = Get-ChildItem 'C:\Windows\System32\DriverStore\FileRepository\u0360470.inf_amd64_35c64671e7fac064' -Filter *.inf -File -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { 'INF NOT FOUND'; exit }
$t = Get-Content $p.FullName -Raw
'  file: ' + $p.Name
'  RX 580  DEV_67DF : ' + [bool]($t -match 'DEV_67DF')
'  RX 6800 DEV_73BF : ' + [bool]($t -match 'DEV_73BF')
'  R9 270X DEV_6810 : ' + [bool]($t -match 'DEV_6810')
'  RX 570  DEV_67DF (same as 580): ' + [bool]($t -match 'DEV_67DF')
'  RX 6600 DEV_73FF : ' + [bool]($t -match 'DEV_73FF')
'  unique device ids: ' + (([regex]::Matches($t, 'DEV_[0-9A-F]{4}') | Select-Object -ExpandProperty Value | Sort-Object -Unique) -join ',')
$m = [regex]::Match($t, 'DriverVer\s*=\s*([^\r\n]+)'); if ($m.Success) { '  DriverVer: ' + $m.Groups[1].Value.Trim() }
'AMD-INF2 DONE'
