$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section 'identity'
'  {0}  user {1}  up {2:N0} min' -f $env:COMPUTERNAME, $env:USERNAME, ((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalMinutes
'  os ' + (Get-CimInstance Win32_OperatingSystem).Caption + ' build ' + (Get-CimInstance Win32_OperatingSystem).BuildNumber
Get-CimInstance Win32_VideoController | ForEach-Object { '  gpu {0} driver {1}' -f $_.Name, $_.DriverVersion }
Section 'the card right now'
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=name,temperature.gpu,fan.speed,power.draw,power.limit,clocks.sm,clocks.mem,utilization.gpu,memory.used,pstate --format=csv,noheader
Section 'fan / thermal readback beyond nvidia-smi'
& 'C:\Windows\System32\nvidia-smi.exe' -q -d TEMPERATURE 2>&1 | Select-String -Pattern 'GPU Current Temp|Fan Speed|GPU Target|Slowdown|Shutdown|Max Operating|Memory Current' | ForEach-Object { '  ' + $_.Line.Trim() }
Section 'is anything already loading the card'
Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)lolminer|srbminer|xmrig|llama|sd-cli|python' } | ForEach-Object {
  $cl = ($_.CommandLine -replace '\s+',' ')
  '  {0,-16} pid {1,-6} {2}' -f $_.Name, $_.ProcessId, $cl.Substring(0,[Math]::Min(90,$cl.Length)) }
Section 'hydra doors here'
foreach ($p in 8125,8127,8130,8136,8137) {
  $c = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { '  {0} UP pid {1}' -f $p, $c.OwningProcess } else { '  {0} ---' -f $p }
}
'  C:\AI contents: ' + ((Get-ChildItem 'C:\AI' -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name) -join ', ')
'  miners: ' + ((Get-ChildItem 'C:\AI\miners' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name) -join ', ')
XPSW PROBE DONE
