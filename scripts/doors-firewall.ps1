$ErrorActionPreference = 'Continue'
'host: ' + $env:COMPUTERNAME
'--- hydra firewall rules'
$r = @(Get-NetFirewallRule -DisplayName 'Hydra*' -ErrorAction SilentlyContinue)
if ($r.Count -eq 0) { '  none present' }
foreach ($x in $r) {
  $pf = $x | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue
  '  {0} | enabled {1} | {2} | {3} | profile {4} | {5}-{6} {7}' -f $x.DisplayName, $x.Enabled, $x.Direction, $x.Action, $x.Profile, $pf.Protocol, $pf.LocalPort, $pf.RemotePort
}
'--- network profiles'
Get-NetConnectionProfile | ForEach-Object { '  {0} / {1} / ifIndex {2}' -f $_.Name, $_.NetworkCategory, $_.InterfaceIndex }
'--- listening doors'
$ports = @(8125, 8127, 8136, 8137, 8138)
foreach ($p in $ports) { if (Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue) { '  {0}: listening' -f $p } else { '  {0}: no listener' -f $p } }
'--- make sure the LAN can reach them'
$existing = @(Get-NetFirewallRule -DisplayName 'Hydra V2 doors 8125-8144' -ErrorAction SilentlyContinue)
if ($existing.Count -eq 0) {
  New-NetFirewallRule -DisplayName 'Hydra V2 doors 8125-8144' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8125-8144 -Profile Any -ErrorAction SilentlyContinue | Out-Null
  '  rule created'
} else {
  $existing | Set-NetFirewallRule -Enabled True -Profile Any -Action Allow -ErrorAction SilentlyContinue
  '  rule present, re-enabled for all profiles'
}
@(Get-NetFirewallRule -DisplayName 'Hydra V2 doors 8125-8144' -ErrorAction SilentlyContinue) | ForEach-Object { '  now: {0} enabled {1} profile {2} action {3}' -f $_.DisplayName, $_.Enabled, $_.Profile, $_.Action }
'DOORS RULE DONE'
