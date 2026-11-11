$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section 'the wifi link it will have to survive on'
& netsh wlan show interfaces 2>&1 | Select-String -Pattern 'Name|Description|State|SSID|BSSID|Channel|Radio type|Receive rate|Transmit rate|Signal' | ForEach-Object { '  ' + $_.Line.Trim() }
Section 'profiles available (what it can join with no human)'
& netsh wlan show profiles 2>&1 | Select-String -Pattern 'All User Profile|Profile' | ForEach-Object { '  ' + $_.Line.Trim() }
Section 'the saved profile settings that matter in a distant room'
$p = (& netsh wlan show profile name=Cisco15095 2>&1) -join "`n"
foreach ($k in 'Connection mode','Network broadcast','AutoSwitch','MAC Randomization','Security key') {
  $m = [regex]::Match($p, [regex]::Escape($k) + '\s*:\s*(.+)')
  if ($m.Success) { '  {0,-20} {1}' -f $k, $m.Groups[1].Value.Trim() }
}
Section 'does the adapter prefer 2.4 or 5'
$adv = Get-NetAdapterAdvancedProperty -Name 'Wi-Fi' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match '(?i)band|5g|preferred|roaming' }
if ($adv) { $adv | ForEach-Object { '  {0} = {1}  (options: {2})' -f $_.DisplayName, $_.DisplayValue, ($_.ValidDisplayValues -join '/') } } else { '  no band-preference property exposed by this driver' }
Section 'power management on the adapter (the classic far-room drop)'
$pm = Get-NetAdapterPowerManagement -Name 'Wi-Fi' -ErrorAction SilentlyContinue
if ($pm) { '  AllowComputerToTurnOffDevice: ' + $pm.AllowComputerToTurnOffDevice } else { '  not readable' }
'JIMS WIFI DONE'
