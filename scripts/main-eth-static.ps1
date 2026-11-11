# Put 192.168.1.100 on the WIRED port now, while the cable is still out.
# Then plugging the cable back at the main station brings the box up on .100 with no DHCP race,
# and the Wi-Fi address (.106) keeps working until someone unplugs it - so the move is reversible.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$nic = Get-NetAdapter -Name 'Ethernet 2' -ErrorAction SilentlyContinue
if (-not $nic) { 'Ethernet 2 not found - adapters:'; Get-NetAdapter | ForEach-Object { '  ' + $_.Name + '  ' + $_.InterfaceDescription }; 'MAIN ETH FAILED'; exit 1 }
Section 'before'
'  adapter: {0}  {1}  {2}' -f $nic.Name, $nic.InterfaceDescription, $nic.Status
Get-NetIPAddress -InterfaceAlias 'Ethernet 2' -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object { '  ip: {0}/{1}  origin {2}' -f $_.IPAddress, $_.PrefixLength, $_.PrefixOrigin }
Get-NetRoute -InterfaceAlias 'Ethernet 2' -ErrorAction SilentlyContinue | Select-Object -First 3 | ForEach-Object { '  route: {0} via {1}' -f $_.DestinationPrefix, $_.NextHop }

Section 'remove any DHCP/APIPA leftovers on that port'
Remove-NetIPAddress -InterfaceAlias 'Ethernet 2' -AddressFamily IPv4 -Confirm:$false -ErrorAction SilentlyContinue
Remove-NetRoute -InterfaceAlias 'Ethernet 2' -DestinationPrefix '0.0.0.0/0' -Confirm:$false -ErrorAction SilentlyContinue
Set-NetIPInterface -InterfaceAlias 'Ethernet 2' -Dhcp Disabled -ErrorAction SilentlyContinue

Section 'set 192.168.1.100/24 on the wired port'
New-NetIPAddress -InterfaceAlias 'Ethernet 2' -IPAddress '192.168.1.100' -PrefixLength 24 -DefaultGateway '192.168.1.1' -ErrorAction SilentlyContinue | Out-Null
Set-DnsClientServerAddress -InterfaceAlias 'Ethernet 2' -ServerAddresses '192.168.1.1','1.1.1.1' -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Section 'after (cable still out, so: address configured, link down)'
Get-NetIPAddress -InterfaceAlias 'Ethernet 2' -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object { '  ip: {0}/{1}  origin {2}  skip-as-source {3}' -f $_.IPAddress, $_.PrefixLength, $_.PrefixOrigin, $_.SkipAsSource }
(Get-NetAdapter -Name 'Ethernet 2').Status | ForEach-Object { '  link: ' + $_ }
Get-NetIPInterface -InterfaceAlias 'Ethernet 2' -AddressFamily IPv4 | ForEach-Object { '  dhcp: ' + $_.Dhcp }
Section 'the wifi path must still work while I am on it'
Get-NetIPAddress -InterfaceAlias 'Wi-Fi' -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object { '  wifi: {0}' -f $_.IPAddress }
Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | ForEach-Object { '  default route: {0} via {1} metric {2}  ({3})' -f $_.DestinationPrefix, $_.NextHop, $_.RouteMetric, $_.InterfaceAlias }
'MAIN ETH DONE'
