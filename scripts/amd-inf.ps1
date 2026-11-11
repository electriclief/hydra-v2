$ErrorActionPreference = 'Continue'
'== AMD display INFs in the driver store and what they cover'
$infs = Get-ChildItem 'C:\Windows\System32\DriverStore\FileRepository' -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^(u0|amd|uhd|c0)' } |
        ForEach-Object { Get-ChildItem $_.FullName -Filter *.inf -File -ErrorAction SilentlyContinue } |
        Where-Object { (Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue) -match 'PCI\\VEN_1002' }
foreach ($f in $infs) {
  $t = Get-Content $f.FullName -Raw
  '  {0}' -f $f.FullName.Replace('C:\Windows\System32\DriverStore\FileRepository\','')
  '    RX 580  DEV_67DF : {0}' -f [bool]($t -match 'DEV_67DF')
  '    RX 6800 DEV_73BF : {0}' -f [bool]($t -match 'DEV_73BF')
  '    R9 270X DEV_6810 : {0}' -f [bool]($t -match 'DEV_6810')
  '    device ids in file: {0}' -f ([regex]::Matches($t, 'DEV_[0-9A-F]{4}') | Select-Object -ExpandProperty Value | Sort-Object -Unique).Count
  $m = [regex]::Match($t, 'DriverVer\s*=\s*([^\r\n]+)')
  if ($m.Success) { '    DriverVer: ' + $m.Groups[1].Value.Trim() }
}
'AMD-INF DONE'
