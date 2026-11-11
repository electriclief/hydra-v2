# Boot-time state for the card test: when it last rebooted, whether autologon is armed, and what is on the bus.
$ErrorActionPreference = 'Continue'
'host       : {0}' -f $env:COMPUTERNAME
'boot time  : {0}' -f (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
'os version : {0}  build {1}' -f (Get-CimInstance Win32_OperatingSystem).Version, (Get-CimInstance Win32_OperatingSystem).BuildNumber
$k = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
$p = Get-ItemProperty $k
'autologon  : AutoAdminLogon={0}  user={1}  domain={2}  password={3}' -f $p.AutoAdminLogon, $p.DefaultUserName, $p.DefaultDomainName,
  $(if ($p.DefaultPassword) { 'stored' } else { 'absent' })
'reboot flag: ' + $(if (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending') { 'PENDING' } else { 'clear' })

'--- display devices present'
$d = @(Get-PnpDevice -PresentOnly -Class Display -ErrorAction SilentlyContinue)
if ($d.Count) { $d | ForEach-Object { '  {0}  status {1}  problem {2}' -f $_.FriendlyName, $_.Status, $_.Problem } } else { '  none' }

'--- nvidia-smi'
$smi = 'C:\Windows\System32\nvidia-smi.exe'
if (Test-Path $smi) { & $smi --query-gpu=name,driver_version,memory.total,memory.used,utilization.gpu,temperature.gpu --format=csv,noheader }
else { '  not installed yet' }
