# The ssh door must survive a reboot. There was no rule for port 22 at all - the connection worked because the profile's
# firewall was permissive, which is exactly the kind of luck that disappears after a reboot or a profile flip from
# Public to Private. So: state the profile truth, then write an explicit rule and prove it exists.
$ErrorActionPreference = 'Continue'
'--- firewall profiles'
Get-NetFirewallProfile | ForEach-Object { '  {0,-8} enabled={1,-5} inboundDefault={2}' -f $_.Name, $_.Enabled, $_.DefaultInboundAction }

$name = 'miner1 sshd 22'
$existing = Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
if (-not $existing) {
  New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Protocol TCP -LocalPort 22 -Profile Any -Description 'sshd from the fleet controller' | Out-Null
  'created rule: ' + $name
} else { 'rule already present: ' + $name }

'--- rules that now allow 22'
Get-NetFirewallRule -Direction Inbound -Action Allow -Enabled True -ErrorAction SilentlyContinue |
  Where-Object {
    $p = $_ | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue
    $p.LocalPort -eq 22 -or $p.LocalPort -eq 'Any'
  } | Select-Object -First 6 DisplayName, Profile, Enabled | Format-Table -AutoSize | Out-String
'--- listener'
Get-NetTCPConnection -LocalPort 22 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { '  {0}:{1} pid {2}  {3}' -f $_.LocalAddress, $_.LocalPort, $_.OwningProcess, (Get-Process -Id $_.OwningProcess).ProcessName }
