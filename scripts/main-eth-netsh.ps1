$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section 'netsh: set the wired port static (this is what actually turns DHCP off on a disconnected NIC)'
& netsh interface ipv4 set address name="Ethernet 2" source=static address=192.168.1.100 mask=255.255.255.0 gateway=192.168.1.1 gwmetric=1 2>&1 | ForEach-Object { '  ' + $_ }
Start-Sleep -Seconds 2
Section 'read back'
Get-NetIPAddress -InterfaceAlias 'Ethernet 2' -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object { '  eth : {0}/{1}  origin {2}' -f $_.IPAddress, $_.PrefixLength, $_.PrefixOrigin }
Get-NetIPInterface -InterfaceAlias 'Ethernet 2' -AddressFamily IPv4 | ForEach-Object { '  eth dhcp {0}  metric {1}' -f $_.Dhcp, $_.InterfaceMetric }
& netsh interface ipv4 show config name="Ethernet 2" 2>&1 | Select-String -Pattern 'DHCP|IP Address|Subnet|Default Gateway' | ForEach-Object { '  ' + $_.Line.Trim() }
Section 'wifi untouched and still carrying this session'
Get-NetIPAddress -InterfaceAlias 'Wi-Fi' -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object { '  wifi: {0}' -f $_.IPAddress }
'MAIN ETH NETS H DONE'
