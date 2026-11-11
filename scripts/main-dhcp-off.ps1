$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$ad = Get-NetAdapter -Name 'Ethernet 2'
$guid = $ad.InterfaceGuid
Section ('registry interface key for ' + $guid)
$key = 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\' + $guid
'  key exists: ' + (Test-Path $key)
if (-not (Test-Path $key)) { 'MAIN DHCP FAILED'; exit 1 }
'  before: EnableDHCP=' + (Get-ItemProperty $key -Name EnableDHCP -ErrorAction SilentlyContinue).EnableDHCP + '  IPAddress=' + ((Get-ItemProperty $key -Name IPAddress -ErrorAction SilentlyContinue).IPAddress -join ',')
Set-ItemProperty $key -Name EnableDHCP -Value 0 -Type DWord
Section 'read back'
'  after : EnableDHCP=' + (Get-ItemProperty $key -Name EnableDHCP).EnableDHCP
& netsh interface ipv4 show config name="Ethernet 2" 2>&1 | Select-String -Pattern 'DHCP enabled|IP Address|Subnet Prefix|Default Gateway' | ForEach-Object { '  ' + $_.Line.Trim() }
Get-NetIPAddress -InterfaceAlias 'Ethernet 2' -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object { '  eth : {0}/{1}  origin {2}' -f $_.IPAddress, $_.PrefixLength, $_.PrefixOrigin }
Section 'the box must still be reachable now (wifi untouched)'
'  wifi ip: ' + (Get-NetIPAddress -InterfaceAlias 'Wi-Fi' -AddressFamily IPv4).IPAddress
'MAIN DHCP OFF DONE'
