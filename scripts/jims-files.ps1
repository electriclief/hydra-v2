$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section 'the launchers that exist'
foreach ($f in 'relaunch-hydra.cmd','shelf-service.cmd','shelf-headless.mjs','open-hydra-window.cmd','launchers') {
  $p = Join-Path 'C:\AI\hydra-local' $f
  if (Test-Path $p) {
    if ((Get-Item $p).PSIsContainer) { '  [dir] ' + $f ; Get-ChildItem $p | ForEach-Object { '        ' + $_.Name } }
    else { '  --- ' + $f + ' (' + (Get-Item $p).Length + ' B)'; Get-Content $p -ErrorAction SilentlyContinue | Select-Object -First 25 | ForEach-Object { '      ' + $_ } }
  }
}
Section 'README-JIMS'
if (Test-Path 'C:\AI\hydra-local\README-JIMS.md') { Get-Content 'C:\AI\hydra-local\README-JIMS.md' | Select-Object -First 40 | ForEach-Object { '  ' + $_ } }
Section 'the tasks, in full'
foreach ($n in 'hydra-mine-gpu','hydra-mine-cpu','jims-hydra-shelf','jims-hydra-shelf-user','jims-hydra-window') {
  $t = Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue
  if ($t) {
    '  --- ' + $n + '  state ' + $t.State
    $t.Actions | ForEach-Object { '      action : {0} {1}' -f $_.Execute, $_.Arguments }
    $t.Triggers | ForEach-Object { '      trigger: {0} delay {1} enabled {2}' -f $_.CimClass.CimClassName, $_.Delay, $_.Enabled }
    '      principal: {0} logon {1} runlevel {2}' -f $t.Principal.UserId, $t.Principal.LogonType, $t.Principal.RunLevel
    $i = Get-ScheduledTaskInfo -TaskName $n -ErrorAction SilentlyContinue
    '      last {0}  result {1} (0x{1:X})' -f $i.LastRunTime, $i.LastTaskResult
  } else { '  --- ' + $n + ' : NOT PRESENT' }
}
Section 'standby guard on this box'
foreach ($p in 'C:\AI\hydra-local\scripts\standby-guard.ps1','C:\AI\tools\standby-guard.ps1') { if (Test-Path $p) { '  exists: ' + $p + '  ' + (Get-Item $p).Length + ' B  ' + (Get-Item $p).LastWriteTime } }
Section 'node.json standby block'
$nj = 'C:\AI\hydra-local\module\Menu\data\node.json'
if (Test-Path $nj) { $j = Get-Content $nj -Raw | ConvertFrom-Json; $j.PSObject.Properties | ForEach-Object { '  {0} = {1}' -f $_.Name, ($_.Value | ConvertTo-Json -Compress -Depth 3) } }
Section 'local accounts'
Get-LocalUser | ForEach-Object { '  {0,-16} enabled={1} passwordRequired={2} lastlogon={3}' -f $_.Name, $_.Enabled, $_.PasswordRequired, $_.LastLogon }
Section 'the miner that is running'
Get-CimInstance Win32_Process | Where-Object Name -match 'SRBMiner' | ForEach-Object { '  ' + ($_.CommandLine -replace '\s+',' ') }
$api = try { Invoke-RestMethod 'http://127.0.0.1:60201/' -TimeoutSec 6 } catch { $null }
if ($api) { $a = @($api.algorithms)[0]; '  api: {0}  {1:N0} H/s  A{2} R{3}' -f $a.name, $a.hashrate.'15min', $a.shares.accepted, $a.shares.rejected } else { '  api 60201 not answering' }
'JIMS FILES DONE'
