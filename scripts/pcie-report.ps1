# What is actually on this rig's PCIe bus, and which slots carry a live card?
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File pcie-report.ps1
#
# Reports four things that answer "are all the slots powered?":
#   1. the SMBIOS slot table - how many slots the board declares, and what the BIOS says is in each
#   2. every display controller Windows can see, with its PCI id and whether it has a working driver
#   3. every VGA / 3D controller on the bus, including ones with no driver at all (a card in a dead slot
#      still appears here or does not appear at all - the difference is the diagnosis)
#   4. a count, so a missing card is a number and not an impression
param([switch]$Json)

$ErrorActionPreference = 'Continue'

# ---- 1. slots the board declares
$slots = @()
try {
  $slots = @(Get-CimInstance Win32_SystemSlot -ErrorAction Stop | ForEach-Object {
    [pscustomobject]@{
      slot    = $_.SlotDesignation
      usage   = $_.CurrentUsage          # 3 = Available, 4 = In Use (per SMBIOS)
      status  = $_.Status
      width   = $_.SlotLength
      bus     = $_.BusNumber
      dev     = $_.DeviceNumber
    }
  })
} catch { }

# ---- 2. display controllers Windows knows about
$vc = @(Get-CimInstance Win32_VideoController | ForEach-Object {
  [pscustomobject]@{
    name        = $_.Name
    pnp         = $_.PNPDeviceID
    status      = $_.Status
    problem     = $_.ConfigManagerErrorCode    # 0 = working, 28 = no driver, 43 = stopped by driver
    driver      = $_.DriverVersion
    vram_mb     = if ($_.AdapterRAM) { [int]($_.AdapterRAM / 1MB) } else { $null }
  }
})

# ---- 3. every VGA/3D controller on the bus, driver or not
$pci = @()
try {
  $pci = @(Get-PnpDevice -PresentOnly -ErrorAction Stop | Where-Object {
    # A card with no driver is classless (Class = ''), so filtering on Class alone
    # silently hides exactly the card this report exists to find. Match name or class.
    $_.InstanceId -like 'PCI\VEN_*' -and (
      $_.Class -in @('Display', 'Display3D') -or
      $_.FriendlyName -match 'VGA|Video Controller|Display Adapter|GeForce|Radeon|Arc Graphics'
    )
  } | ForEach-Object {
    $v = if ($_.InstanceId -match 'VEN_([0-9A-F]{4})') { $matches[1] } else { '' }
    $d = if ($_.InstanceId -match 'DEV_([0-9A-F]{4})') { $matches[1] } else { '' }
    $bus = (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName 'DEVPKEY_Device_BusNumber' -ErrorAction SilentlyContinue).Data
    [pscustomobject]@{
      instance = $_.InstanceId
      friendly = $_.FriendlyName
      status   = [string]$_.Status
      problem  = $_.Problem
      class    = [string]$_.Class
      bus      = $bus
      vendor   = $v
      device   = $d
      pci      = ('{0}:{1}' -f $v, $d)
    }
  })
} catch { }

# ---- 4. summary
$displayCount = $pci.Count
$working = @($pci | Where-Object { $_.status -eq 'OK' }).Count
$errored = @($pci | Where-Object { $_.status -ne 'OK' }).Count
$driverless = @($pci | Where-Object { -not $_.class }).Count
$inUseSlots = @($slots | Where-Object { $_.usage -eq 4 }).Count

if ($Json) {
  [pscustomobject]@{
    host = $env:COMPUTERNAME
    slots = $slots
    video = $vc
    controllers = $pci
    counts = [pscustomobject]@{ controllers = $displayCount; ok = $working; problem = $errored; driverless = $driverless; slots_declared = $slots.Count; slots_in_use = $inUseSlots }
  } | ConvertTo-Json -Depth 5
  return
}

'host: {0}' -f $env:COMPUTERNAME
''
'--- SMBIOS slot table'
if ($slots.Count) {
  $slots | Format-Table @{ n = 'slot'; e = { $_.slot } }, @{ n = 'usage'; e = { switch ($_.usage) { 3 { 'available' } 4 { 'IN USE' } default { $_.usage } } } }, status, bus, dev -AutoSize | Out-String -Width 120 | Write-Host
  '{0} slots declared by the board, {1} reported in use' -f $slots.Count, $inUseSlots
} else {
  '  the BIOS exposes no SMBIOS slot table - count from the controllers below instead'
}
''
'--- display controllers on the PCI bus (driver or not)'
if ($pci.Count) {
  $pci | Sort-Object bus, instance | Format-Table @{ n = 'bus'; e = { $_.bus } }, @{ n = 'pci id'; e = { $_.pci } }, @{ n = 'status'; e = { $_.status } }, problem, @{ n = 'class'; e = { if ($_.class) { $_.class } else { 'NONE' } } }, @{ n = 'name'; e = { $_.friendly } } -AutoSize | Out-String -Width 160 | Write-Host
} else { '  none found' }
''
'--- Windows display adapters'
if ($vc.Count) {
  $vc | Format-Table name, status, problem, driver, vram_mb -AutoSize | Out-String -Width 140 | Write-Host
} else { '  none' }
''
'--- summary'
'  controllers present : {0}' -f $displayCount
'  with a working driver: {0}' -f $working
'  with a problem      : {0}' -f $errored
'  with no driver at all (classless): {0}' -f $driverless
''
if ($displayCount -lt 2) {
  '  ONE OR NONE: a rig expected to hold several cards is only reporting {0}. A card in an unpowered slot' -f $displayCount
  '  does not appear here at all, so check the riser power and the slot, not the driver.'
}
