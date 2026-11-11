$ErrorActionPreference = 'Continue'
$d = $null
try { $d = Invoke-RestMethod 'http://127.0.0.1:60151/' -TimeoutSec 8 } catch { 'api down'; }
if ($d) {
  '  top keys: ' + (($d.PSObject.Properties | Select-Object -ExpandProperty Name) -join ', ')
  '  Software: ' + $d.Software
  '  Session : ' + (($d.Session.PSObject.Properties | ForEach-Object { $_.Name + '=' + $_.Value }) -join '  ')
  foreach ($p in $d.PSObject.Properties) {
    if ($p.Name -notin 'Software','Session','Workers') { '  ' + $p.Name + ': ' + (($p.Value | ConvertTo-Json -Compress -Depth 3)) }
  }
}
'  --- card'
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=temperature.gpu,fan.speed,power.draw,clocks.sm,utilization.gpu --format=csv,noheader
'  --- process'
'  lolMiner running: ' + @(Get-Process lolMiner -ErrorAction SilentlyContinue).Count
'XPSW RATE DONE'
