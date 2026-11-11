# SRBMiner says "Found 1 OpenCL platforms, but none is AMD, NVIDIA OR INTEL" - NVIDIA's OpenCL ICD is not registered on this
# box, because only the display INF was installed. The DLL is in the driver-store package; registering it is what NVIDIA's own
# installer does. If OpenCL comes up, the 1050 Ti can mine on the OpenCL backend instead of the CUDA path that OOMs.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }

Section 'find the OpenCL runtime inside the driver store package'
$pkg = @(Get-ChildItem 'C:\Windows\System32\DriverStore\FileRepository' -Directory -Filter 'nv_dispi.inf_*' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending)
'  packages: {0}' -f $pkg.Count
$dll = $null
foreach ($p in $pkg) {
  $c = Join-Path $p.FullName 'nvopencl64.dll'
  '  {0} : {1}' -f $p.Name, (Test-Path $c)
  if (-not $dll -and (Test-Path $c)) { $dll = $c }
}
if (-not $dll) { '  nvopencl64.dll not found in the package - OpenCL component was not installed'; }

Section 'current Khronos registration'
$key = 'HKLM:\SOFTWARE\Khronos\OpenCL\Vendors'
if (Test-Path $key) {
  $props = Get-ItemProperty $key
  $props.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { '  {0} = {1}' -f $_.Name, $_.Value }
} else { '  key does not exist' }

if ($dll) {
  Section 'register it'
  if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
  New-ItemProperty -Path $key -Name $dll -PropertyType DWord -Value 0 -Force | Out-Null
  '  registered: ' + $dll
  $props = Get-ItemProperty $key
  $props.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { '  {0}' -f $_.Name }

  Section 'does SRBMiner see an NVIDIA OpenCL platform now'
  (& 'C:\AI\miners\srb380\SRBMiner-MULTI.exe' --list-devices 2>&1 | Where-Object { $_ -match '(?i)opencl|platform|gpu|device' } | Select-Object -First 12) |
    ForEach-Object { '  ' + ($_ -replace "`0", '') }
}
'OPENCL DONE'
