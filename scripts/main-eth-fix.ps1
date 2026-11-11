$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section 'finish the wired port: static only, and preferred over wifi'
Set-NetIPInterface -InterfaceAlias 'Ethernet 2' -AddressFamily IPv4 -Dhcp Disabled -ErrorAction SilentlyContinue
Set-NetIPInterface -InterfaceAlias 'Ethernet 2' -AddressFamily IPv4 -InterfaceMetric 10 -ErrorAction SilentlyContinue
Set-NetIPInterface -InterfaceAlias 'Wi-Fi'      -AddressFamily IPv4 -InterfaceMetric 50 -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Get-NetIPAddress -InterfaceAlias 'Ethernet 2' -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object { '  eth : {0}/{1}  origin {2}' -f $_.IPAddress, $_.PrefixLength, $_.PrefixOrigin }
Get-NetIPInterface -InterfaceAlias 'Ethernet 2' -AddressFamily IPv4 | ForEach-Object { '  eth dhcp {0}  metric {1}' -f $_.Dhcp, $_.InterfaceMetric }
Get-NetIPAddress -InterfaceAlias 'Wi-Fi' -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object { '  wifi: {0}/{1}  origin {2}' -f $_.IPAddress, $_.PrefixLength, $_.PrefixOrigin }
Get-NetIPInterface -InterfaceAlias 'Wi-Fi' -AddressFamily IPv4 | ForEach-Object { '  wifi metric {0}' -f $_.InterfaceMetric }
Section 'still reachable over wifi while the cable is out'
Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | ForEach-Object { '  default: via {0} metric {1} ({2})' -f $_.NextHop, $_.RouteMetric, $_.InterfaceAlias }
'MAIN ETH FIX DONE'
