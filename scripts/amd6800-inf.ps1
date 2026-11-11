$ErrorActionPreference = 'Continue'
'== AMD display INFs on THIS box (which has an RX 6800)'
$infs = Get-ChildItem 'C:\Windows\System32\DriverStore\FileRepository' -Directory -ErrorAction SilentlyContinue |
        ForEach-Object { Get-ChildItem $_.FullName -Filter *.inf -File -ErrorAction SilentlyContinue } |
        Where-Object { (Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue) -match 'PCI\\VEN_1002' }
foreach ($f in $infs) {
  $t = Get-Content $f.FullName -Raw
  $has6 = [bool]($t -match 'DEV_67DF')
  $has7 = [bool]($t -match 'DEV_73BF')
  if ($has6 -or $has7) {
    $m = [regex]::Match($t, 'DriverVer\s*=\s*([^\r\n]+)')
    '  {0}' -f $f.Name
    '    DriverVer {0}   Polaris RX580(67DF)={1}   RDNA2 RX6800(73BF)={2}' -f $m.Groups[1].Value.Trim(), $has6, $has7
  }
}
'== what Windows has bound right now'
Get-CimInstance Win32_VideoController | ForEach-Object { '  {0,-36} {1}' -f $_.Name, $_.DriverVersion }
'AMD6800-INF DONE'
