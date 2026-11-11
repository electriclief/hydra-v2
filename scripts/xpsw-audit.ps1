$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section 'is this a full install or a copy'
'  C:\AI\hydra-local\module        : ' + (Test-Path 'C:\AI\hydra-local\module')
'  module folders                 : ' + @(Get-ChildItem 'C:\AI\hydra-local\module' -Directory -ErrorAction SilentlyContinue).Count
'  .git present                   : ' + (Test-Path 'C:\AI\hydra-local\.git')
'  git.exe on PATH                : ' + $(if (Get-Command git -ErrorAction SilentlyContinue) { (Get-Command git).Source } else { 'NO - cannot clone or update' })
'  node / electron                : ' + (Test-Path 'C:\AI\hydra-local\tools\node\node.exe') + ' / ' + (Test-Path 'C:\AI\hydra-local\tools\electron\electron.exe')
'  node.json ref                  : ' + ((Get-Content 'C:\AI\hydra-local\module\Menu\data\node.json' -Raw | ConvertFrom-Json).ref)
Section 'what it declares'
try { $s = Invoke-RestMethod 'http://127.0.0.1:8128/api/services' -TimeoutSec 8; $n = @($s.services) | ForEach-Object { $_.name }; '  services: ' + ($n -join ', ') } catch { '  services door not answering' }
Section 'doors'
foreach ($p in 8125,8127,8128,8130,8133,8136,8137) {
  $c = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { '  {0} UP pid {1}' -f $p, $c.OwningProcess } else { '  {0} ---' -f $p }
}
Section 'the app process: which session (0 = invisible, 1 = on the screen)'
Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)electron|shelf-headless' } | ForEach-Object {
  '  {0,-16} pid {1,-6} session {2}' -f $_.Name, $_.ProcessId, $_.SessionId }
& query session 2>&1 | ForEach-Object { '  ' + $_ }
Section 'is it mining'
'  lolMiner processes: ' + @(Get-Process lolMiner -ErrorAction SilentlyContinue).Count
try { $a = Invoke-RestMethod 'http://127.0.0.1:60151/' -TimeoutSec 6; $alg = @($a.Algorithms)[0]; '  {0} {1:N2} MH/s  A{2} R{3}  up {4} min' -f $alg.Algorithm, $alg.Total_Performance, $alg.Total_Accepted, $alg.Total_Rejected, [int](($a.Session.Uptime)/60) } catch { '  miner api not answering' }
Section 'autostart pieces'
'  Startup lnk    : ' + (Test-Path "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Hydra V2.lnk")
$w = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
'  autologon      : ' + $w.AutoAdminLogon + ' / ' + $w.ForceAutoLogon + ' user ' + $w.DefaultUserName
'  update-check row: ' + $(try { (@(Invoke-RestMethod 'http://127.0.0.1:8125/api/processes' -TimeoutSec 6).processes | Where-Object { $_.name -eq 'update-check' }).Count } catch { 'pw down' })
'XPSW INSTALL AUDIT DONE'
