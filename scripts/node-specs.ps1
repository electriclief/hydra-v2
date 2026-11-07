<#
  What this machine IS, as state.

  Every node writes this at start and on demand; the Menu and Echidna read it instead of asking. Specs are facts about
  hardware and belong in State exactly like idle/standby: a node that is live says what it can do, and a node that stops
  heartbeating is not chosen for anything.

  Writes module/Menu/data/specs.json (node-local, never committed) and prints one compact line.
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'module\Menu\data\specs.json'

$cs  = Get-CimInstance Win32_ComputerSystem
$os  = Get-CimInstance Win32_OperatingSystem
$cpu = @(Get-CimInstance Win32_Processor)
$gpu = @(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name })
$disks = @(Get-CimInstance Win32_DiskDrive | Sort-Object Index | ForEach-Object {
  [ordered]@{
    index = [int]$_.Index
    model = ("$($_.Model)").Trim()
    sizeGB = [math]::Round($_.Size/1GB,1)
    bus = $_.InterfaceType
    partitions = [int]$_.Partitions
    status = $_.Status
  }
})

$ref = 'unknown'
$nodeFile = Join-Path $root 'module\Menu\data\node.json'
if (Test-Path $nodeFile) { try { $ref = (Get-Content $nodeFile -Raw | ConvertFrom-Json).ref } catch { } }
if ($ref -eq 'unknown') { $ref = $env:COMPUTERNAME.ToLower() }

$specs = [ordered]@{
  ref      = $ref
  host     = $env:COMPUTERNAME
  at       = (Get-Date).ToString('s')
  os       = ("$($os.Caption) $($os.Version)").Trim()
  model    = ("$($cs.Manufacturer) $($cs.Model)").Trim()
  cpu      = ($cpu | ForEach-Object { ("$($_.Name)").Trim() }) -join ' + '
  cores    = ($cpu | Measure-Object -Property NumberOfCores -Sum).Sum
  threads  = ($cpu | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum
  ramGB    = [math]::Round($cs.TotalPhysicalMemory/1GB,0)
  gpus     = $gpu
  # A node with no real GPU says so: 'Microsoft Basic Display Adapter' means software rendering, not compute.
  gpuCompute = (@($gpu | Where-Object { $_ -notmatch 'Basic Display|Remote|Mirror' }).Count -gt 0)
  disks    = $disks
  uptimeH  = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours,1)
}
$specs | ConvertTo-Json -Depth 5 | Set-Content -Path $out -Encoding UTF8

$gpuTxt = if ($specs.gpuCompute) { ($gpu -join ', ') } else { 'none (software display)' }
"{0} | {1} | {2}c/{3}t | {4} GB RAM | GPU: {5} | {6} disks" -f `
  $specs.ref, $specs.model, $specs.cores, $specs.threads, $specs.ramGB, $gpuTxt, @($disks).Count
