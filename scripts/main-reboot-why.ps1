$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section 'why did it reboot on its own'
$os = Get-CimInstance Win32_OperatingSystem
'  last boot : ' + $os.LastBootUpTime
'  up (min)  : ' + [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalMinutes, 1)
'  now       : ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
Get-WinEvent -FilterHashtable @{LogName='System'; Id=1074,41,6008,6005,6006} -MaxEvents 8 -ErrorAction SilentlyContinue |
  ForEach-Object { '  {0:MM-dd HH:mm:ss} id {1,-5} {2}' -f $_.TimeCreated, $_.Id, ((($_.Message -split "`n")[0]) -replace '\s+',' ').Trim().Substring(0,[Math]::Min(130, ((($_.Message -split "`n")[0]) -replace '\s+',' ').Trim().Length)) }
Section 'was it Windows Update'
Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Microsoft-Windows-WindowsUpdateClient'} -MaxEvents 4 -ErrorAction SilentlyContinue |
  ForEach-Object { '  {0:MM-dd HH:mm} id {1} {2}' -f $_.TimeCreated, $_.Id, ((($_.Message -split "`n")[0]) -replace '\s+',' ').Trim() }
Section 'the wire, still configured and still waiting for a cable'
Get-NetAdapter -Name 'Ethernet 2' | ForEach-Object { '  {0}  {1}  {2}' -f $_.Name, $_.Status, $_.MacAddress }
Get-NetIPAddress -InterfaceAlias 'Ethernet 2' -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object { '  ip {0}/{1}  origin {2}' -f $_.IPAddress, $_.PrefixLength, $_.PrefixOrigin }
Get-NetIPInterface -InterfaceAlias 'Ethernet 2' -AddressFamily IPv4 | ForEach-Object { '  dhcp {0}  metric {1}' -f $_.Dhcp, $_.InterfaceMetric }
Get-NetIPInterface -InterfaceAlias 'Wi-Fi' -AddressFamily IPv4 | ForEach-Object { '  wifi metric {0}' -f $_.InterfaceMetric }
Get-NetIPAddress -InterfaceAlias 'Wi-Fi' -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object { '  wifi ip {0}' -f $_.IPAddress }
Section 'autologon (it asked for a password, so this is what is missing)'
$wl = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
'  AutoAdminLogon={0}  ForceAutoLogon={1}  user={2}  DefaultPassword set={3}' -f $wl.AutoAdminLogon, $wl.ForceAutoLogon, $wl.DefaultUserName, [bool]$wl.DefaultPassword
Get-LocalUser | Where-Object { $_.Enabled } | ForEach-Object { '  account {0} passwordRequired={1}' -f $_.Name, $_.PasswordRequired }
Section 'what is running now'
Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)node|electron|python' } | Select-Object -First 8 | ForEach-Object {
  $cl = ($_.CommandLine -replace '\s+',' ')
  '  {0,-12} pid {1,-6} {2}' -f $_.Name, $_.ProcessId, $cl.Substring(0,[Math]::Min(80,$cl.Length)) }
'MAIN REBOOT DONE'
