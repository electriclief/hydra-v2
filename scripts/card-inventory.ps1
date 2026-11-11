# CLASSIFY EVERY CARD IN THE BOX IN ONE PASS.
#
# A photo tells you what the sticker says. This tells you what Windows actually enumerated: PCI IDs (which decide
# the model), the real VRAM from the driver's own registry key (Win32_VideoController.AdapterRAM lies above 4 GB and
# reports garbage on old cards), the driver provider and date, and which card is driving the display.
#
# Run it as Administrator on the node, after sshd answers:  powershell -File card-inventory.ps1
$ErrorActionPreference = 'SilentlyContinue'

'== video controllers Windows sees'
$vcs = Get-CimInstance Win32_VideoController
$i = 0
foreach ($v in $vcs) {
  $i++
  '{0}. {1}' -f $i, $v.Name
  '   pnp        {0}' -f $v.PNPDeviceID
  '   driver     {0}  ({1})  provider {2}' -f $v.DriverVersion, $v.DriverDate, $v.AdapterCompatibility
  '   vram(cim)  {0:N0} MB   (unreliable above 4 GB)' -f ($v.AdapterRAM / 1MB)
  '   display    {0}x{1} @ {2} Hz' -f $v.CurrentHorizontalResolution, $v.CurrentVerticalResolution, $v.CurrentRefreshRate
  if ($v.Status) { '   status     {0}' -f $v.Status }
}

'== real VRAM, straight from the display driver registry keys'
$cls = 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}'
Get-ChildItem $cls -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -match '^\d{4}$' } | ForEach-Object {
  $k = Get-ItemProperty $_.PSPath
  if (-not $k.DriverDesc) { return }
  $mem = $null
  $hi = Get-ItemProperty (Join-Path $_.PSPath 'HardwareInformation') -ErrorAction SilentlyContinue
  if ($hi.qwMemorySize) { $mem = [int64]$hi.qwMemorySize }
  '{0,-40} {1,10} MB   {2}   {3}' -f $k.DriverDesc, $(if ($mem) { [math]::Round($mem / 1MB) } else { '?' }), $k.ProviderName, $k.DriverVersion
}

'== PCI devices that are display class but have no driver (the ones Windows does not know)'
Get-PnpDevice -Class Display -ErrorAction SilentlyContinue |
  Select-Object Status, FriendlyName, InstanceId |
  Format-Table -AutoSize | Out-String | Write-Output

'== what compute APIs exist on this box'
'{0,-24} {1}' -f 'vulkan-1.dll', $(if (Test-Path 'C:\Windows\System32\vulkan-1.dll') { 'present' } else { 'MISSING' })
'{0,-24} {1}' -f 'OpenCL (OpenCL.dll)', $(if (Test-Path 'C:\Windows\System32\OpenCL.dll') { 'present' } else { 'MISSING' })
'{0,-24} {1}' -f 'nvidia-smi', $(if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) { 'present - cards below' } else { 'absent' })
& nvidia-smi --query-gpu=index,name,memory.total,pci.bus_id,driver_version --format=csv,noheader 2>$null

'== verdict table: fill the Model column by matching the DEV_ id'
'   VEN_1002 = AMD/ATI · VEN_10DE = NVIDIA · VEN_8086 = Intel'
'   AMD device ids worth memorising: 68F9=Cedar(HD5450/5550) 68E4=Seymour(HD6400) 683F=Cape Verde(HD7750)'
'     67DF=Polaris10(RX470/570/580) 67FF=Polaris11(RX460/560) 73DF=Navi22(RX6700)'
'   NVIDIA: 0DE1=GT430 104A=GT610 1C03=GTX1060 1B80=GTX1080 1401=GTX980Ti 13C2=GTX970 1C82=GTX1050Ti'
