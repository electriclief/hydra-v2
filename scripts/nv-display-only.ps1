# Install ONLY the display INF (the previous run started adding all 30+ packages, audio first - pointless and slow on
# two cores). Kills that run, adds nv_dispi.inf, rescans, and reports which INF the card actually bound to.
$ErrorActionPreference = 'Continue'
$dir = 'C:\AI\tools\nv582'
$inf = $null
foreach ($c in @(Get-ChildItem $dir -Recurse -Filter 'nv_dispi.inf' -ErrorAction SilentlyContinue)) { $inf = $c.FullName; break }
if (-not $inf) { foreach ($c in @(Get-ChildItem $dir -Recurse -Filter 'nv*.inf' -ErrorAction SilentlyContinue | Where-Object { $_.DirectoryName -match 'Display' })) { $inf = $c.FullName; break } }

'--- stopping the broad run'
foreach ($p in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'nv-inf-install' -or $_.Name -eq 'pnputil.exe' })) {
  '  kill {0} {1}' -f $p.Name, $p.ProcessId
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 3

'--- display INF'
if (-not $inf) { 'no display INF under ' + $dir; return }
'  ' + $inf

$sw = [Diagnostics.Stopwatch]::StartNew()
& pnputil /add-driver $inf /install 2>&1 | ForEach-Object { '  ' + $_.Trim() } | Select-Object -First 12
$sw.Stop()
'  took {0:N0} s' -f $sw.Elapsed.TotalSeconds

'--- rescan'
& pnputil /scan-devices 2>&1 | Select-Object -Last 2 | ForEach-Object { '  ' + $_.Trim() }
Start-Sleep -Seconds 10

'--- what the card bound to'
foreach ($d in @(Get-PnpDevice -PresentOnly -Class Display -ErrorAction SilentlyContinue)) {
  $inst = $null
  try { $inst = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName 'DEVPKEY_Device_DriverInfPath' -ErrorAction Stop).Data } catch { }
  $ver = $null
  try { $ver = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName 'DEVPKEY_Device_DriverVersion' -ErrorAction Stop).Data } catch { }
  '  {0,-32} status {1,-8} problem {2,-18} inf {3} v{4}' -f $d.FriendlyName, $d.Status, $d.Problem, $inst, $ver
}
'--- nvidia-smi'
if (Test-Path 'C:\Windows\System32\nvidia-smi.exe') { & 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=name,driver_version,memory.total --format=csv,noheader }
else { '  absent (NVML ships with the store/container package; the display driver may still be bound)' }
'DISPLAY-ONLY DONE'
