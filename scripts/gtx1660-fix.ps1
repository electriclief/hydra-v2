# Three things were wrong, and all three are why the box looked offline while it was working:
#   1. no firewall rule for the door range -> every door answers locally and refuses the LAN
#   2. doors raised from an ssh session die with that session -> raise via WMI Create instead
#   3. the shelf does not raise Core/Mirror (the Electron app does), so they need their own raise
$ErrorActionPreference = 'Continue'
$node = 'C:\Program Files\nodejs\node.exe'
$root = 'C:\AI\hydra-local'
function Section($t) { '' ; '=== ' + $t }

Section '1. firewall: allow the door range from the LAN'
$r = Get-NetFirewallRule -DisplayName 'Hydra V2 doors 8125-8144' -ErrorAction SilentlyContinue
if (-not $r) { New-NetFirewallRule -DisplayName 'Hydra V2 doors 8125-8144' -Direction Inbound -Protocol TCP -LocalPort 8125-8144 -Action Allow -Profile Any | Out-Null; '  created' } else { '  already present' }
$r2 = Get-NetFirewallRule -DisplayName 'Hydra V2 doors 8125-8144'
'  enabled={0} action={1} profiles={2}' -f $r2.Enabled, $r2.Action, $r2.Profile
$blocks = @(Get-NetFirewallRule -Direction Inbound -Action Block -Enabled True -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'node.exe*' })
'  block rules on node.exe: ' + $blocks.Count
$blocks | ForEach-Object { Remove-NetFirewallRule -Name $_.Name -ErrorAction SilentlyContinue; '    removed ' + $_.DisplayName }

Section '2. raise Core and Mirror detached (WMI, so they outlive this ssh session)'
foreach ($m in @(@{ name = 'Core'; port = 8136 }, @{ name = 'Mirror'; port = 8137 })) {
  $live = Get-NetTCPConnection -State Listen -LocalPort $m.port -ErrorAction SilentlyContinue
  if ($live) { '  {0} already on {1} (pid {2})' -f $m.name, $m.port, $live.OwningProcess; continue }
  $cmd = 'cmd.exe /c "cd /d ' + $root + '\module\' + $m.name + ' && \"' + $node + '\" src/main.js --port ' + $m.port + ' --host 0.0.0.0 >> ' + $root + '\logs\' + $m.name.ToLower() + '.log 2>&1"'
  $res = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd }
  '  {0} -> returnValue {1} pid {2}' -f $m.name, $res.ReturnValue, $res.ProcessId
}
Start-Sleep -Seconds 12

Section '3. doors now (and who owns them)'
foreach ($p in 8125,8127,8128,8129,8130,8131,8132,8133,8136,8137) {
  $c = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { '  {0} UP pid {1} {2}' -f $p, $c.OwningProcess, $c.LocalAddress } else { '  {0} ---' -f $p }
}
Section '4. what ref it publishes'
try {
  $s = Invoke-RestMethod 'http://127.0.0.1:8127/api/state?prefix=node.' -TimeoutSec 8
  $refs = @($s.entries | ForEach-Object { ($_.path -split '\.')[1] } | Sort-Object -Unique)
  '  refs seen: ' + ($refs -join ', ')
} catch { '  state door not answering' }
'  node.json ref: ' + ((Get-Content ($root + '\module\Menu\data\node.json') -Raw | ConvertFrom-Json).ref)
'1660 FIX DONE'
