# Switch the GTX 1650 from the Windows-Update driver (oem4.inf / 30.0.14.7280 / 472.80) to the staged full package
# (oem8.inf / 32.0.15.9186 / 591.86). pnputil /add-driver staged it but the device kept the older node driver, which is
# why CUDA kernels failed with CUDA_ERROR_INVALID_IMAGE and OpenCL with error -52: the kernels are newer than the driver.
# Removing the old package and rescanning makes PnP pick the only remaining NVIDIA display package.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }

Section 'before'
& pnputil /enum-devices /instanceid 'PCI\VEN_10DE&DEV_1F82&SUBSYS_A548174B&REV_A1\4&37C305EE&0&00E0' /drivers 2>&1 |
  Where-Object { $_ -match '(?i)Driver Name|Driver Version|Status|Original' } | ForEach-Object { '  ' + $_.Trim() }

Section 'removing oem4.inf (the Windows Update package)'
& pnputil /delete-driver oem4.inf /uninstall /force 2>&1 | ForEach-Object { '  ' + $_.Trim() }

Section 'rescan'
& pnputil /scan-devices 2>&1 | Select-Object -Last 2 | ForEach-Object { '  ' + $_.Trim() }

Section 'waiting for a healthy device'
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  $d = @(Get-PnpDevice -PresentOnly -Class Display -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -match '(?i)nvidia' -and $_.Status -eq 'OK' })
  if ($d.Count) { $ok = $true; break }
  Start-Sleep -Seconds 10
}
'healthy: {0}' -f $ok

Section 'after'
foreach ($x in @(Get-PnpDevice -PresentOnly -Class Display -ErrorAction SilentlyContinue)) {
  $inf = $null; $ver = $null
  try { $inf = (Get-PnpDeviceProperty -InstanceId $x.InstanceId -KeyName 'DEVPKEY_Device_DriverInfPath' -ErrorAction Stop).Data } catch { }
  try { $ver = (Get-PnpDeviceProperty -InstanceId $x.InstanceId -KeyName 'DEVPKEY_Device_DriverVersion' -ErrorAction Stop).Data } catch { }
  '  {0,-30} {1,-8} {2,-18} {3}  {4}' -f $x.FriendlyName, $x.Status, $x.Problem, $inf, $ver
}
if (Test-Path 'C:\Windows\System32\nvidia-smi.exe') {
  try { & 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=name,driver_version,memory.total --format=csv,noheader } catch { '  smi failed' }
}
'opencl dll : ' + (Test-Path 'C:\Windows\System32\nvopencl64.dll')
'ogl dll    : ' + (Test-Path 'C:\Windows\System32\nvoglv64.dll')

Section 'do the kernels load now'
$srb = 'C:\AI\miners\srbminer\SRBMiner-MULTI.exe'
if (Test-Path $srb) {
  $p = Start-Process -FilePath $srb -WorkingDirectory 'C:\AI\miners\srbminer' -PassThru -WindowStyle Hidden -ArgumentList @(
    '--algorithm', 'xelishashv3', '--pool', 'stratum+tcp://xelishash.unmineable.com:3333',
    '--wallet', 'leafdriving2.unmineable_miner_miner1', '--disable-cpu', '--api-enable', '--api-port', '60206',
    '--gpu-sensors-disable', '--log-file', 'C:\AI\logs\switch-test.txt')
  Start-Sleep -Seconds 90
  try {
    $a = Invoke-RestMethod 'http://127.0.0.1:60206/' -TimeoutSec 6
    $alg = @($a.algorithms) | Select-Object -First 1
    '  rate(15m): {0}  accepted {1}  rejected {2}' -f $alg.hashrate.'15min', $alg.shares.accepted, $alg.shares.rejected
  } catch { '  api: ' + $_.Exception.Message }
  try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { }
  Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  if (Test-Path 'C:\AI\logs\switch-test.txt') {
    Get-Content 'C:\AI\logs\switch-test.txt' | Where-Object { $_ -match '(?i)h/s|error|CUDA|kernel|init' } | Select-Object -Last 8 | ForEach-Object { '  ' + $_ }
  }
}
'SWITCH DONE'
