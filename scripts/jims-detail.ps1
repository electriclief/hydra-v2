$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section 'run-gpu.cmd'
$f = 'C:\AI\miners\run-gpu.cmd'
if (Test-Path $f) { Get-Content $f | ForEach-Object { '  ' + $_ } } else { '  MISSING ' + $f }
Section 'run-cpu.cmd'
$f2 = 'C:\AI\miners\run-cpu.cmd'
if (Test-Path $f2) { Get-Content $f2 | ForEach-Object { '  ' + $_ } } else { '  MISSING ' + $f2 }
Section 'shelf-service.log tail'
$p = 'C:\AI\hydra-local\logs\shelf-service.log'
if (Test-Path $p) { Get-Content $p -Tail 20 | ForEach-Object { '  ' + ($_ -replace '\s+',' ').Trim() } } else { '  no shelf-service.log' }
Section 'relaunch.log tail'
$p2 = 'C:\AI\hydra-local\logs\relaunch.log'
if (Test-Path $p2) { Get-Content $p2 -Tail 12 | ForEach-Object { '  ' + ($_ -replace '\s+',' ').Trim() } } else { '  no relaunch.log' }
Section 'power / sleep (a laptop WILL sleep unless told not to)'
powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE 2>&1 | Select-String -Pattern 'Current AC|Current DC|Settings' | ForEach-Object { '  ' + $_.Line.Trim() }
powercfg /query SCHEME_CURRENT SUB_VIDEO VIDEOIDLE 2>&1 | Select-String -Pattern 'Current AC|Current DC' | ForEach-Object { '  ' + $_.Line.Trim() }
'  active scheme: ' + ((powercfg /getactivescheme) -join '')
'  HiberbootEnabled: ' + (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -Name HiberbootEnabled -ErrorAction SilentlyContinue).HiberbootEnabled
'  lid close action (AC): ' + ((powercfg /query SCHEME_CURRENT SUB_BUTTONS LIDACTION 2>&1 | Select-String 'Current AC') -replace '\s+',' ')
'  on AC: ' + (Get-CimInstance -ClassName BatteryStatus -Namespace root\wmi -ErrorAction SilentlyContinue | ForEach-Object { 'PowerOnline=' + $_.PowerOnline }) 
Section 'existing startup items'
foreach ($d in "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup", 'C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Startup') {
  '  --- ' + $d
  Get-ChildItem $d -ErrorAction SilentlyContinue | ForEach-Object { '      ' + $_.Name }
}
Section 'miner log tail (what the running one has done)'
$p3 = 'C:\AI\miners\logs\gpu.log'
if (Test-Path $p3) { Get-Content $p3 -Tail 4 | ForEach-Object { '  ' + ($_ -replace '\s+',' ').Trim() } }
'JIMS DETAILS DONE'
