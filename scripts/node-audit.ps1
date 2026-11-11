# Does this node come back as a Hydra node that mines, by itself? One read of everything that decides it.
# Written because the fleet answer has to be a measurement per node, not "it looked fine yesterday".
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$root = 'C:\AI\hydra-local'
$os = Get-CimInstance Win32_OperatingSystem
$wl = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'

Section 'box'
'  {0}  {1}' -f $env:COMPUTERNAME, $os.Caption
'  boot {0:yyyy-MM-dd HH:mm}  up {1} min' -f $os.LastBootUpTime, [int]((Get-Date) - $os.LastBootUpTime).TotalMinutes
'  autologon {0}  force {1}  user {2}  password set {3}' -f $wl.AutoAdminLogon, $wl.ForceAutoLogon, $wl.DefaultUserName, [bool]$wl.DefaultPassword

Section 'what starts at logon'
$sh = New-Object -ComObject WScript.Shell
Get-ChildItem ([Environment]::GetFolderPath('Startup')) -ErrorAction SilentlyContinue | ForEach-Object {
  $t = ''; if ($_.Name -like '*.lnk') { try { $t = $sh.CreateShortcut($_.FullName).TargetPath + ' ' + $sh.CreateShortcut($_.FullName).Arguments } catch { } }
  '  startup: {0} -> {1}' -f $_.Name, $t
}
Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.Triggers.CimClass.CimClassName -match 'Logon|Boot' } |
  Where-Object { $_.State -ne 'Disabled' -and ($_.TaskName -match 'hydra|mine|unmin|miner|wall|studio') } |
  ForEach-Object { '  task: {0} [{1}]  {2}' -f $_.TaskName, $_.State, (($_.Actions | ForEach-Object { ('' + $_.Execute) + ' ' + ('' + $_.Arguments) }) -join ' | ') }
Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue |
  ForEach-Object { $_.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { '  run: {0} = {1}' -f $_.Name, $_.Value } }

Section 'hydra'
'  install: ' + (Test-Path (Join-Path $root 'module\Basic_App')) + '   git: ' + (Test-Path (Join-Path $root '.git'))
$nj = Join-Path $root 'module\Menu\data\node.json'
if (Test-Path $nj) {
  $j = Get-Content $nj -Raw | ConvertFrom-Json
  '  ref: {0}   standby.after: {1}   miner start: {2}' -f $j.ref, $j.standby.after, (($j.standby.start.command) + ' ' + (($j.standby.start.args) -join ' '))
} else { '  node.json: MISSING' }
$ports = @(8125, 8127, 8128, 8130, 8136, 8137, 8138)
$up = @(); foreach ($p in $ports) { if (Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue) { $up += $p } }
'  doors: {0}/{1} -> {2}' -f $up.Count, $ports.Count, ($up -join ' ')
try {
  $rows = @((Invoke-RestMethod 'http://127.0.0.1:8125/api/processes' -TimeoutSec 6).processes | Where-Object { $_.life -eq 'running' })
  '  running rows: ' + $rows.Count + '  (' + (($rows | ForEach-Object { $_.name }) -join ', ') + ')'
  $rows | Where-Object { $_.name -match 'standby|monitor' } | ForEach-Object { '    {0} pid {1}' -f $_.name, $_.pid }
} catch { '  processwrapper not answering on 8125' }
try { $c = (Invoke-RestMethod 'http://127.0.0.1:8138/api/monitor' -TimeoutSec 5).monitor.card; if ($c) { '  monitor: [{0}] {1} — {2}' -f $c.kind, $c.title, $c.text } else { '  monitor: empty board' } } catch { '  monitor: echidna not answering' }

Section 'mining'
$m = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'lolMiner|SRBMiner|xmrig|gminer|teamredminer' })
'  miner processes: ' + $m.Count
$m | ForEach-Object { '    {0} pid {1}  {2}' -f $_.Name, $_.ProcessId, ((([string]$_.CommandLine) -replace '\s+',' ') ) }
foreach ($p in 60130, 60131, 60151, 60201, 60220, 61235, 21550) {
  try { $a = Invoke-RestMethod ("http://127.0.0.1:" + $p + "/") -TimeoutSec 3; $g = @($a.Algorithms)[0]; if ($g -and $g.Algorithm) { '  api {0}: {1} {2} MH/s A{3} R{4}' -f $p, $g.Algorithm, $g.Total_Performance, $g.Total_Accepted, $g.Total_Rejected } elseif ($a.algorithms) { '  api {0}: algorithm data present' -f $p } } catch { }
}
$g = 'C:\AI\hydra-local\data\standby\guard.log'
if (Test-Path $g) { '  guard.log tail:'; Get-Content $g -Tail 3 | ForEach-Object { '    ' + ($_ -replace '\s+',' ').Trim() } } else { '  guard.log: none' }

Section 'gpu'
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=name,temperature.gpu,power.draw,utilization.gpu,clocks.sm --format=csv,noheader 2>$null
Get-CimInstance Win32_VideoController | ForEach-Object { '  adapter: {0}  {1}' -f $_.Name, $_.DriverVersion }
'NODE AUDIT DONE'
