param(
  [int]$IntervalSec = 20,
  [int]$TopN = 5,
  [switch]$Once
)
# system-sampler.ps1 -- the drain watch's eyes. One compact JSON line per interval:
# total CPU, the top CPU processes (delta over the window), per-drive disk activity,
# the top IO processes, and process names never seen before. CPU + disks only, never GPU.
# It writes no files -- its stdout is captured by ProcessWrapper as the sampler's one
# life file (ONE LIFE = ONE FILE). Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/system-sampler.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/system-sampler.ps1 -Once   (one sample, exit)
$ErrorActionPreference = 'SilentlyContinue'

$cores = 8
try { $cores = [int](Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors } catch {}
if ($cores -lt 1) { $cores = 8 }

# Prime the CPU deltas: one Get-Process pass, CPU seconds per pid.
$seenNames = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$prevCpu = @{}
$prevT = Get-Date
foreach ($p in (Get-Process)) { if ($null -ne $p.CPU) { $prevCpu[$p.Id] = $p.CPU } }
$first = $true

while ($true) {
  $sleepSec = $IntervalSec
  if ($Once -and $sleepSec -gt 3) { $sleepSec = 3 }
  Start-Sleep -Seconds $sleepSec
  $nowT = Get-Date
  $dt = ($nowT - $prevT).TotalSeconds

  # --- processes: CPU delta + names never seen before ---
  $procs = @(Get-Process)
  $rows = New-Object System.Collections.ArrayList
  $newNames = New-Object System.Collections.ArrayList
  $newPrev = @{}
  $sumPct = 0.0
  foreach ($p in $procs) {
    $pc = $p.CPU
    if ($null -eq $pc) { continue }
    $old = $prevCpu[$p.Id]
    $newPrev[$p.Id] = $pc
    $name = [string]$p.ProcessName
    if (-not $seenNames.Contains($name)) {
      [void]$seenNames.Add($name)
      if (-not $first) { [void]$newNames.Add($name) }
    }
    if ($null -eq $old -or $dt -le 0.5) { continue }
    $d = $pc - $old
    if ($d -le 0) { continue }
    $pct = [math]::Round(100.0 * $d / $dt / $cores, 1)
    $sumPct += $pct
    if ($pct -ge 1) { [void]$rows.Add([pscustomobject]@{ name = $name; pid = [int]$p.Id; cpu = $pct }) }
  }
  if ($sumPct -gt 100) { $sumPct = 100 }
  $cpuTotal = [math]::Round($sumPct, 1)
  $topCpu = @($rows | Sort-Object cpu -Descending | Select-Object -First $TopN)

  # --- disks: per-drive busy + read/write (one CIM call) ---
  $disk = @()
  $bt = $null
  $d = Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk
  if ($null -ne $d) {
    $dl = New-Object System.Collections.ArrayList
    foreach ($row in $d) {
      if ($null -eq $row.PercentIdleTime) { continue }
      $busy = [math]::Round(100.0 - [double]$row.PercentIdleTime, 1)
      if ($busy -lt 0) { $busy = 0 }
      [void]$dl.Add([pscustomobject]@{
        id = [string]$row.Name
        busy = $busy
        readMBs = [math]::Round(([double]$row.DiskReadBytesPerSec) / 1048576.0, 2)
        writeMBs = [math]::Round(([double]$row.DiskWriteBytesPerSec) / 1048576.0, 2)
      })
    }
    $disk = @($dl)
    $bt = $dl | Where-Object { $_.id -notlike '*_Total*' } | Sort-Object busy -Descending | Select-Object -First 1
  }

  # --- per-process IO (one CIM call) ---
  $topIo = @()
  $io = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process
  if ($null -ne $io) {
    $topIo = @($io | Where-Object { $_.Name -ne '_Total' } | ForEach-Object {
      $r = [double]$_.IOReadBytesPerSec
      $w = [double]$_.IOWriteBytesPerSec
      [pscustomobject]@{
        name = [string]$_.Name
        pid = [int]$_.IDProcess
        readMBs = [math]::Round($r / 1048576.0, 2)
        writeMBs = [math]::Round($w / 1048576.0, 2)
        ioMBs = [math]::Round(($r + $w) / 1048576.0, 2)
      }
    } | Sort-Object ioMBs -Descending | Select-Object -First $TopN)
  }

  $obj = [ordered]@{
    t         = $nowT.ToString('yyyy-MM-dd HH:mm:ss')
    cores     = $cores
    cpuTotal  = $cpuTotal
    procs     = $procs.Count
    top       = $topCpu
    disk      = $disk
    busy      = $(if ($null -ne $bt) { $bt.id + ' ' + [string]$bt.busy + '%' } else { '' })
    topIO     = $topIo
    newNames  = @($newNames)
  }
  $json = $obj | ConvertTo-Json -Compress -Depth 5
  Write-Output $json

  if ($Once) { break }
  $prevCpu = $newPrev
  $prevT = $nowT
  $first = $false
}
