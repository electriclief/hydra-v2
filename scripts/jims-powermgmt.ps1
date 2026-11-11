$ErrorActionPreference = 'Continue'
# The classic far-room failure: Windows is allowed to switch the wifi adapter off to save power,
# and in a weak-signal room that looks exactly like a dead node. Turn it off and read it back.
$n = 'Wi-Fi'
'  before: ' + ((Get-NetAdapterPowerManagement -Name $n -ErrorAction SilentlyContinue).AllowComputerToTurnOffDevice)
Disable-NetAdapterPowerManagement -Name $n -ErrorAction SilentlyContinue
Start-Sleep -Seconds 4
'  after : ' + ((Get-NetAdapterPowerManagement -Name $n -ErrorAction SilentlyContinue).AllowComputerToTurnOffDevice)
'  --- wifi still associated?'
& netsh wlan show interfaces 2>&1 | Select-String -Pattern 'State|SSID|Signal|Channel' | ForEach-Object { '    ' + $_.Line.Trim() }
'  ip: ' + (Get-NetIPAddress -InterfaceAlias 'Wi-Fi' -AddressFamily IPv4 -ErrorAction SilentlyContinue).IPAddress
# also stop Windows from powering down the USB root hubs the dongle/camera sit on - a laptop in another room
foreach ($h in Get-CimInstance -Namespace root\wmi -ClassName MSPower_DeviceEnable -ErrorAction SilentlyContinue) {
  if ($h.Enable -eq $true) { $h.Enable = $false; Set-CimInstance -InputObject $h -ErrorAction SilentlyContinue }
}
'POWERMGMT DONE'
