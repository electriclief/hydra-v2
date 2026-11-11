# Wait for the display driver to actually bind to the card, then say what the state is. No polling from the controller.
# Ends the moment the NVIDIA device is healthy, or after the timeout, with enough detail to decide the next move.
param([int]$Minutes = 35)
$ErrorActionPreference = 'Continue'
$deadline = (Get-Date).AddMinutes($Minutes)
$bound = $false

while ((Get-Date) -lt $deadline) {
  $disp = @(Get-PnpDevice -PresentOnly -Class Display -ErrorAction SilentlyContinue)
  $nv = @($disp | Where-Object { $_.FriendlyName -match '(?i)nvidia|geforce' -and $_.Status -eq 'OK' })
  $busy = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '(?i)drvinst|pnputil' })
  '{0}  display: {1}   installers: {2}' -f (Get-Date).ToString('HH:mm:ss'),
    (($disp | ForEach-Object { $_.FriendlyName + '=' + $_.Status + '/' + $_.Problem }) -join ' ; '), $busy.Count
  if ($nv.Count) { $bound = $true; break }
  Start-Sleep -Seconds 20
}

''
if ($bound) { 'BOUND - the NVIDIA device is healthy' } else { 'NOT BOUND within {0} minutes' -f $Minutes }

'--- device detail'
foreach ($d in @(Get-PnpDevice -PresentOnly -Class Display -ErrorAction SilentlyContinue)) {
  $inf = $null; $ver = $null
  try { $inf = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName 'DEVPKEY_Device_DriverInfPath' -ErrorAction Stop).Data } catch { }
  try { $ver = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName 'DEVPKEY_Device_DriverVersion' -ErrorAction Stop).Data } catch { }
  '  {0,-32} {1,-8} {2,-18} inf {3} v{4}' -f $d.FriendlyName, $d.Status, $d.Problem, $inf, $ver
}
'--- nvidia-smi'
if (Test-Path 'C:\Windows\System32\nvidia-smi.exe') { & 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=name,driver_version,memory.total --format=csv,noheader }
else { '  absent - the display driver is bound but NVML is not running; a reboot is the normal next step' }
'--- nvlddmkm service'
Get-Service nvlddmkm -ErrorAction SilentlyContinue | ForEach-Object { '  {0} {1} {2}' -f $_.Name, $_.Status, $_.StartType }
'WAIT-DRIVER DONE'
