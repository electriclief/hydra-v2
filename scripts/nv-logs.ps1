# Where did the silent NVIDIA install go? Find anything it wrote in the last two hours and show its tail.
$ErrorActionPreference = 'Continue'
$cut = (Get-Date).AddHours(-2)
$roots = @(
  "$env:ProgramData\NVIDIA Corporation",
  "$env:LOCALAPPDATA\Temp",
  "C:\Windows\Temp",
  "C:\NVIDIA",
  "$env:ProgramData\NVIDIA"
) | Where-Object { Test-Path $_ }

'now  : {0}' -f (Get-Date).ToString('HH:mm:ss')
'--- files written since {0}' -f $cut.ToString('HH:mm')
foreach ($r in $roots) {
  $f = @(Get-ChildItem $r -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $_.LastWriteTime -gt $cut -and $_.Length -lt 5MB } |
      Sort-Object LastWriteTime -Descending | Select-Object -First 12)
  if ($f.Count) {
    '' ; '== ' + $r
    foreach ($x in $f) { '  {0}  {1,8:N0} KB  {2}' -f $x.LastWriteTime.ToString('HH:mm:ss'), ($x.Length / 1KB), $x.FullName }
  }
}

'--- any installer log text worth reading'
foreach ($x in @(Get-ChildItem "$env:ProgramData\NVIDIA Corporation" -Recurse -Filter '*.log' -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -First 3)) {
  ''; '== ' + $x.FullName
  Get-Content $x.FullName -Tail 15 | ForEach-Object { '  ' + $_ }
}

'--- services the installer needs'
Get-Service DeviceInstall, msiserver, WSearch, Winmgmt, TrustedInstaller -ErrorAction SilentlyContinue |
  ForEach-Object { '  {0,-18} {1,-8} {2}' -f $_.Name, $_.Status, $_.StartType }

'--- pending reboot / setup state'
'  CBS RebootPending : ' + (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending')
'  WU RebootRequired : ' + (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired')
'  DeviceProblem     : ' + ((Get-PnpDevice -PresentOnly -Class Display -ErrorAction SilentlyContinue | ForEach-Object { $_.FriendlyName + '=' + $_.Problem }) -join ' | ')
