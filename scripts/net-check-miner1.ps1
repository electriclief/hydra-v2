$ErrorActionPreference = 'Continue'
'== network adapters (can this box do WiFi at all?)'
Get-NetAdapter -ErrorAction SilentlyContinue | ForEach-Object {
  '  {0,-34} {1,-12} {2,-8} {3}' -f $_.Name, $_.InterfaceDescription, $_.Status, $_.LinkSpeed
}
'== wifi capability'
$w = Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.PhysicalMediaType -match 'Native 802.11|Wireless' }
if ($w) { $w | ForEach-Object { '  wireless: ' + $_.InterfaceDescription + '  ' + $_.Status } } else { '  NO wireless adapter present' }
'== addresses'
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch '^127' } | ForEach-Object { '  {0,-16} {1,-18} {2}' -f $_.IPAddress, $_.InterfaceAlias, $_.PrefixLength }
Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | ForEach-Object { '  default via ' + $_.NextHop + ' on ' + $_.InterfaceAlias }
'== dhcp or static'
Get-NetIPInterface -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceAlias -notmatch 'Loopback' } | ForEach-Object { '  {0,-22} DHCP={1}' -f $_.InterfaceAlias, $_.Dhcp }
'NET DONE'
