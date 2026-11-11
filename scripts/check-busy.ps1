# Is pnputil working or wedged? CPU time per process plus overall load tells the difference.
$ErrorActionPreference = 'Continue'
'now      : {0}' -f (Get-Date).ToString('HH:mm:ss')
'load     : {0} %' -f (Get-CimInstance Win32_Processor).LoadPercentage
'--- installers and their CPU'
foreach ($p in @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '(?i)pnputil|drvinst|setup|nvidia' })) {
  '  {0,-22} pid {1,-6} cpu {2,6:N0} s   mem {3,5:N0} MB' -f $p.ProcessName, $p.Id, $p.CPU, ($p.WorkingSet64 / 1MB)
}
'--- driver store: is nv_dispi staged?'
& pnputil /enum-drivers 2>&1 | Select-String -Pattern 'nv_dispi|nvidia' -Context 0,3 | Select-Object -First 12 | ForEach-Object { '  ' + $_.Line.Trim() }
'--- display devices'
Get-PnpDevice -PresentOnly -Class Display -ErrorAction SilentlyContinue |
  ForEach-Object { '  {0,-34} {1,-8} {2}' -f $_.FriendlyName, $_.Status, $_.Problem }
