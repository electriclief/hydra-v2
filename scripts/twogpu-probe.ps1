# Both cards, stated separately: what Windows bound, what each card negotiated on its slot, and what the three toolchains
# can see. Written for a two-GPU box so a card cannot hide behind the other's numbers.
$ErrorActionPreference = 'Continue'
'=== display devices'
foreach ($d in @(Get-PnpDevice -PresentOnly -Class Display -ErrorAction SilentlyContinue)) {
  $inf = $null; $ver = $null; $w = $null; $s = $null; $mw = $null; $ms = $null
  foreach ($k in 'DEVPKEY_Device_DriverInfPath', 'DEVPKEY_Device_DriverVersion', 'DEVPKEY_PciDevice_CurrentLinkWidth',
    'DEVPKEY_PciDevice_CurrentLinkSpeed', 'DEVPKEY_PciDevice_MaxLinkWidth', 'DEVPKEY_PciDevice_MaxLinkSpeed') {
    try {
      $v = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName $k -ErrorAction Stop).Data
      switch ($k) {
        'DEVPKEY_Device_DriverInfPath' { $inf = $v }
        'DEVPKEY_Device_DriverVersion' { $ver = $v }
        'DEVPKEY_PciDevice_CurrentLinkWidth' { $w = $v }
        'DEVPKEY_PciDevice_CurrentLinkSpeed' { $s = $v }
        'DEVPKEY_PciDevice_MaxLinkWidth' { $mw = $v }
        'DEVPKEY_PciDevice_MaxLinkSpeed' { $ms = $v }
      }
    } catch { }
  }
  ''
  '  {0}' -f $d.FriendlyName
  '    status {0} / {1}   instance {2}' -f $d.Status, $d.Problem, $d.InstanceId
  '    driver {0}  {1}' -f $inf, $ver
  '    link   x{0} gen{1}   max x{2} gen{3}' -f $w, $s, $mw, $ms
}

''
'=== nvidia-smi'
$smi = 'C:\Windows\System32\nvidia-smi.exe'
if (Test-Path $smi) {
  & $smi --query-gpu=index,name,pci.bus_id,memory.total,driver_version,pcie.link.gen.current,pcie.link.width.current --format=csv
} else { '  nvidia-smi absent' }

''
'=== llama.cpp devices'
$cli = 'C:\AI\llama\llama-cli.exe'
if (Test-Path $cli) { & $cli --list-devices 2>&1 | Select-Object -First 14 | ForEach-Object { '  ' + $_ } }

''
'=== SRBMiner 3.8.0 devices'
$srb = 'C:\AI\miners\srb380\SRBMiner-MULTI.exe'
if (Test-Path $srb) {
  (& $srb --list-devices 2>&1 | Where-Object { $_ -match '(?i)gpu|device|platform|cuda|opencl' }) |
    Select-Object -First 14 | ForEach-Object { '  ' + ($_ -replace "`0", '') }
}
'TWOGPU PROBE DONE'
