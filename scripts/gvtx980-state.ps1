$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }

Section 'node.json standby block'
$nj = 'C:\AI\hydra-local\module\Menu\data\node.json'
if (Test-Path $nj) { (Get-Content $nj -Raw | ConvertFrom-Json).standby | ConvertTo-Json -Depth 5 } else { 'missing' }

Section 'the v2 launcher this box uses'
foreach ($f in 'C:\AI\hydra-local\start-hydra-980.cmd','C:\AI\hydra-local\scripts\relaunch-hydra.cmd','C:\AI\hydra-local\relaunch-hydra.cmd') {
  if (Test-Path $f) { '--- ' + $f; Get-Content $f | ForEach-Object { '    ' + $_ } }
}

Section 'the tasks that start things'
foreach ($t in 'echidna-mine','echidna-mine-gpu','hydra-pw-window','hydra-consoles','Hydra-980ti-Studio-Logon') {
  $x = Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
  if ($x) {
    $acts = @()
    foreach ($a in $x.Actions) { $acts += (('' + $a.Execute) + ' ' + ('' + $a.Arguments)) }
    '  {0,-26} [{1}]  {2}' -f $t, $x.State, ($acts -join ' | ')
  } else { '  {0,-26} absent' -f $t }
}

Section 'the wall we want on screen'
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | ForEach-Object {
  $cl = '' + $_.CommandLine
  if ($cl -match 'wall') { '  pid {0} session {1}  {2}' -f $_.ProcessId, $_.SessionId, ($cl -replace '\s+',' ') }
}

Section 'miner APIs answering'
foreach ($p in 6007,60151,60201,60202,60220) {
  try { $r = Invoke-RestMethod ("http://127.0.0.1:" + $p + "/") -TimeoutSec 4; '  {0}: {1}' -f $p, ((@($r.Algorithms)[0].Algorithm) + ' ' + (@($r.Algorithms)[0].Total_Performance) + ' Mh/s') } catch { '  {0}: no answer' -f $p }
}

Section 'why the screenshot failed'
Get-ScheduledTaskInfo -TaskName 'gvtx980-shot' -ErrorAction SilentlyContinue | Select-Object LastRunTime, LastTaskResult | ForEach-Object { '  last run {0}  result {1}' -f $_.LastRunTime, $_.LastTaskResult }
'  capture-screen.ps1 present: ' + (Test-Path 'C:\AI\hydra-local\scripts\capture-screen.ps1')
'GVTX980 STATE DONE'
