# Two independent attempts at giving the 1050 Ti a working mining path:
# A) put nvopencl64.dll where the loader expects it (System32) and point the ICD at that copy
# B) prove whether the CUDA OOM is xelishashv3-specific by mining autolykos2 on that card alone (needs ~2.2 GB of 4 GB)
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }

Section 'A) OpenCL DLL into System32'
$src = 'C:\Windows\System32\DriverStore\FileRepository\nv_dispi.inf_amd64_ed7df476d41060e6\nvopencl64.dll'
foreach ($f in 'nvopencl64.dll', 'nvopencl32.dll') {
  $s = Join-Path (Split-Path $src) $f
  if (Test-Path $s) {
    try { Copy-Item $s ('C:\Windows\System32\' + $f) -Force -ErrorAction Stop; '  copied ' + $f } catch { '  copy failed ' + $f + ' : ' + $_.Exception.Message }
  } else { '  not in package: ' + $f }
}
$key = 'HKLM:\SOFTWARE\Khronos\OpenCL\Vendors'
New-Item -Path $key -Force | Out-Null
Get-ItemProperty $key | ForEach-Object { $_.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { Remove-ItemProperty -Path $key -Name $_.Name -ErrorAction SilentlyContinue } }
New-ItemProperty -Path $key -Name 'C:\Windows\System32\nvopencl64.dll' -PropertyType DWord -Value 0 -Force | Out-Null
'  ICD now: C:\Windows\System32\nvopencl64.dll'
(& 'C:\AI\miners\srb380\SRBMiner-MULTI.exe' --list-devices 2>&1 | Where-Object { $_ -match '(?i)opencl|platform|cuda' } | Select-Object -First 8) |
  ForEach-Object { '  ' + ($_ -replace "`0", '') }

Section 'B) autolykos2 on the 1050 Ti alone (75 s)'
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
$log = 'C:\AI\logs\solo1050-autolykos.txt'
Remove-Item $log -Force -ErrorAction SilentlyContinue
$p = Start-Process -FilePath 'C:\AI\miners\srb380\SRBMiner-MULTI.exe' -WorkingDirectory 'C:\AI\miners\srb380' -PassThru -WindowStyle Hidden -ArgumentList @(
  '--algorithm', 'autolykos2', '--pool', 'stratum+tcp://autolykos.unmineable.com:3333',
  '--wallet', 'leafdriving2.unmineable_miner_miner1', '--disable-cpu', '--gpu-id', '1',
  '--api-enable', '--api-port', '60216', '--gpu-sensors-disable', '--log-file', $log
)
Start-Sleep -Seconds 75
try {
  $a = Invoke-RestMethod 'http://127.0.0.1:60216/' -TimeoutSec 8
  $alg = @($a.algorithms)[0]
  '  rate {0} MH/s  accepted {1}' -f $alg.hashrate.'15min', $alg.shares.accepted
} catch { '  api: ' + $_.Exception.Message }
try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { }
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
if (Test-Path $log) { Get-Content $log | Where-Object { $_ -match '(?i)h/s|error|cuda|program|init|dag' } | Select-Object -Last 6 | ForEach-Object { '  ' + $_ } }
'OC-AUTOLYKOS DONE'
