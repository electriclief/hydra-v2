# What the slots are, what is in them, and how each link actually negotiated.
#   - the SMBIOS slot table (designation + current usage) - what the board says it has
#   - every PCIe device with its location, current link width/speed and the maximum it could do
#   - the display/compute controllers by themselves, because those are the ones that matter on a rig
# A card in a dead slot does not appear at all; a card in a live slot that negotiated x1 instead of x16 appears here
# with the number beside it - which is the difference between "it works" and "it works at a quarter speed".
$ErrorActionPreference = 'Continue'

'host      : {0}' -f $env:COMPUTERNAME
'cpu       : {0}   cores {1}   threads {2}' -f (Get-CimInstance Win32_Processor | Select-Object -First 1).Name,
  (Get-CimInstance Win32_Processor | Select-Object -First 1).NumberOfCores,
  (Get-CimInstance Win32_Processor | Select-Object -First 1).NumberOfLogicalProcessors
'board     : {0} {1}' -f (Get-CimInstance Win32_ComputerSystem).Manufacturer, (Get-CimInstance Win32_ComputerSystem).Model
'ram       : {0:N1} GB' -f ((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)

'=== SMBIOS slot table'
$slots = @(Get-CimInstance Win32_SystemSlot -ErrorAction SilentlyContinue)
if ($slots.Count) {
  foreach ($s in $slots) {
    '  {0,-14} {1,-26} {2}' -f $s.SlotDesignation, $s.CurrentUsage, ($s.SlotType -replace '_', ' ')
  }
  '  total declared slots: {0}' -f $slots.Count
} else { '  the SMBIOS exposes no slot table on this board' }

function LinkFacts($inst) {
  $out = @{ width = $null; speed = $null; maxw = $null; maxs = $null; loc = $null }
  foreach ($k in 'DEVPKEY_PciDevice_CurrentLinkWidth', 'DEVPKEY_PciDevice_CurrentLinkSpeed',
    'DEVPKEY_PciDevice_MaxLinkWidth', 'DEVPKEY_PciDevice_MaxLinkSpeed', 'DEVPKEY_Device_LocationInfo') {
    try {
      $p = Get-PnpDeviceProperty -InstanceId $inst -KeyName $k -ErrorAction Stop
      $v = $p.Data
      switch ($k) {
        'DEVPKEY_PciDevice_CurrentLinkWidth' { $out.width = $v }
        'DEVPKEY_PciDevice_CurrentLinkSpeed' { $out.speed = $v }
        'DEVPKEY_PciDevice_MaxLinkWidth' { $out.maxw = $v }
        'DEVPKEY_PciDevice_MaxLinkSpeed' { $out.maxs = $v }
        'DEVPKEY_Device_LocationInfo' { $out.loc = $v }
      }
    } catch { }
  }
  return $out
}

'=== every PCIe device, with the link it negotiated'
$devs = @(Get-PnpDevice -PresentOnly -Class 'Display', '3D Video Controller', 'System', 'SCSIAdapter' -ErrorAction SilentlyContinue)
$pci = @()
foreach ($d in $devs) {
  if (-not $d.InstanceId -or $d.InstanceId -notmatch '^PCI\\') { continue }
  $pci += $d
}
# also catch controllers with no driver at all, which never land in a class
$unknown = @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -match '^PCI\\' -and $_.Class -notin @('Display', 'System', 'SCSIAdapter') -and $_.FriendlyName -match '(?i)vga|3d|display|graphics|video' })
foreach ($u in $unknown) { if ($pci.InstanceId -notcontains $u.InstanceId) { $pci += $u } }

$rows = @()
foreach ($d in $pci) {
  $f = LinkFacts $d.InstanceId
  $rows += [pscustomobject]@{
    name   = $d.FriendlyName
    status = $d.Status
    loc    = $f.loc
    width  = $f.width
    speed  = $f.speed
    maxw   = $f.maxw
    maxs   = $f.maxs
    problem = $d.Problem
  }
}
$rows | Sort-Object name | Format-Table -AutoSize -Wrap | Out-String -Width 160 | Write-Host

'=== display / compute controllers only'
$gpus = @($rows | Where-Object { $_.name -match '(?i)nvidia|radeon|amd|geforce|gpu|vga|display' })
if ($gpus.Count) {
  foreach ($g in $gpus) {
    '  {0}' -f $g.name
    '     location   : {0}' -f $g.loc
    '     link       : x{0} @ {1}   (max x{2} @ {3})' -f $g.width, $g.speed, $g.maxw, $g.maxs
    '     status     : {0}   problem {1}' -f $g.status, $g.problem
  }
  '  controllers present: {0}' -f $gpus.Count
  '  working (Status OK): {0}' -f (@($gpus | Where-Object { $_.status -eq 'OK' }).Count)
  '  problem-coded     : {0}' -f (@($gpus | Where-Object { $_.problem -and $_.problem -ne 0 }).Count)
} else {
  '  no display/compute controller on the bus at all'
}

'=== PCI bridges (these are the root ports the slots hang from)'
$bridges = @(Get-PnpDevice -PresentOnly -Class 'System' -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -match '(?i)pci.*bridge|root port|pcie' })
'  bridge-like devices: {0}' -f $bridges.Count
foreach ($b in ($bridges | Select-Object -First 12)) {
  $f = LinkFacts $b.InstanceId
  '    {0,-40} x{1} @ {2}   {3}' -f ($b.FriendlyName -replace '\s+', ' '), $f.width, $f.speed, $f.loc
}
