# =====================================================================================
#  disk-facts.ps1 - everything observable about a drive, as JSON, so a page can be printed.
#
#  Runs on the machine the drive is plugged into. Reads only: SMART, the Windows disk and
#  volume tables, and a BOUNDED listing of the filesystem (so "empty" vs "has data" is a
#  measurement, not an impression). Never writes to the drive.
#
#    powershell -File disk-facts.ps1                      # every disk, one JSON per disk
#    powershell -File disk-facts.ps1 -Disk 3              # just PhysicalDrive 3
#    powershell -File disk-facts.ps1 -Out C:\AI\reports\disk-facts
#    powershell -File disk-facts.ps1 -ScanSeconds 120     # longer file count on a big drive
# =====================================================================================
param(
  [int]$Disk = -1,
  [string]$Out = 'C:\AI\reports\disk-facts',
  [int]$ScanSeconds = 75,
  [string]$SmartCtl = 'C:\Program Files\smartmontools\bin\smartctl.exe',
  [string]$Bridge = '',
  [switch]$NoScan          # the data on this drive is not wanted: skip the walk, answer only "reuse or toss"
)
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force $Out | Out-Null

if (-not (Test-Path $SmartCtl)) {
  foreach ($cand in @('C:\Program Files\smartmontools\bin64\smartctl.exe', 'C:\Program Files (x86)\smartmontools\bin\smartctl.exe')) {
    if (Test-Path $cand) { $SmartCtl = $cand; break }
  }
}
if (-not (Test-Path $SmartCtl)) { throw 'smartctl not found - install smartmontools' }

function FmtHuman {
  param($b)
  if ($b -ge 1GB) { return ('{0:0.00} GB' -f ([double]$b / 1GB)) }
  if ($b -ge 1MB) { return ('{0:0.0} MB' -f ([double]$b / 1MB)) }
  return ('{0} KB' -f [math]::Round([double]$b / 1KB))
}

function Run-Ctl {
  param([string[]]$Arguments)
  $o = & $SmartCtl @Arguments 2>&1
  return @{ code = $LASTEXITCODE; text = ($o -join "`n") }
}

$ATTR = @{
  '5'='reallocated'; '9'='poweron_hours'; '12'='power_cycles'; '187'='reported_uncorrectable'
  '188'='command_timeouts'; '190'='air_temp_max'; '194'='temperature'; '196'='reallocation_events'
  '197'='pending_sectors'; '198'='offline_uncorrectable'; '199'='crc_errors'; '193'='load_cycles'
  '231'='life_left_pct'; '240'='head_flying_hours'
  '233'='flash_writes_gib'; '173'='erase_cycles'; '192'='unsafe_shutdowns'; '169'='bad_block_rate'
}

function Get-Attrs {
  param([string]$Text)
  $map = [ordered]@{}
  foreach ($line in ($Text -split "`n")) {
    $t = $line.Trim()
    if ($t -notmatch '^(\d{1,3})\s+(\S+)\s+0x[0-9a-fA-F]+\s') { continue }
    $id = $matches[1]; $nm = $matches[2]
    $fields = @($t -split '\s+')
    $raw = $fields[$fields.Count - 1]
    $num = 0
    if ([int]::TryParse(($raw -replace '[^0-9].*$', ''), [ref]$num)) {
      $key = if ($ATTR.ContainsKey($id)) { $ATTR[$id] } else { 'attr_' + $id }
      $map[$key] = $num
      $map['name_' + $id] = $nm
    }
    # WHICH attribute failed: "health FAILED" with every raw value at zero looks like a lie until the
    # normalised VALUE is compared with its own THRESH, and the answer is often spin-up time, not bad sectors
    if ($t -match 'FAILING_NOW') {
      $value = if ($fields.Count -ge 4) { $fields[3] } else { '?' }
      $thresh = if ($fields.Count -ge 6) { $fields[5] } else { '?' }
      $map['failing'] = ('{0} {1} - value {2} against threshold {3}' -f $id, $nm, $value, $thresh)
    }
  }
  return $map
}

# ---- smartctl's own view of the devices, so no guessing about /dev names
$scan = Run-Ctl @('--scan-open')
$devs = @()
foreach ($line in ($scan.text -split "`n")) {
  if ($line -match '^(/dev/\S+)\s+-d\s+(\S+)') { $devs += [pscustomobject]@{ dev = $matches[1]; type = $matches[2] } }
}

# ---- physical disks, and a capacity match between smartctl's /dev/sdN and Windows' PhysicalDrive N
function Get-CapacityBytes {
  param([string]$Text)
  # take the number from the CAPACITY LINE, never from the whole text: smartctl's own banner says
  # "r5714 [x86_64...]", and a loose match on the full output reads 5714 as the disk size
  $capLine = ($Text -split "`n" | Where-Object { $_ -match '^\s*(User Capacity|Total NVM Capacity|Namespace 1 Size/Capacity):' } | Select-Object -First 1)
  if ($capLine -and $capLine -match '([\d,]{6,})') { return [int64](($matches[1]) -replace ',', '') }
  return [int64]0
}

$diskTable = @(Get-Disk | Sort-Object Number)
$reports = @()

# ---- what to report: every Windows disk that has a smartctl device, PLUS every smartctl device that Windows
# has no disk object for. That second case is the whole point of a pile of loose drives: a disk with no
# partition table gets no Get-Disk entry, and skipping it would hide exactly the blank ones worth keeping.
function Get-DeviceFacts {
  param($Dev, [string]$Bridge)
  # try the type smartctl suggested for this device, then fall back to 'auto': old USB-IDE bridges are
  # mis-detected as usbjmicron/sat and refuse every SMART command, while -d auto gets through
  $type = if ($Bridge) { $Bridge } else { $Dev.type }
  $run = Run-Ctl @('-i', '-d', $type, $Dev.dev)
  if ($run.text -notmatch 'Device Model|Model Number|Product:') {
    $run = Run-Ctl @('-i', '-d', 'auto', $Dev.dev)
    if ($run.text -match 'Device Model|Model Number|Product:') { $type = 'auto' }
  }
  [pscustomobject]@{ text = $run.text; type = $type; bytes = (Get-CapacityBytes $run.text) }
}

$targets = @()
foreach ($d in $diskTable) {
  foreach ($dv in $devs) {
    $f = Get-DeviceFacts -Dev $dv -Bridge $Bridge
    if ($f.bytes -gt 0 -and [math]::Abs($f.bytes - [int64]$d.Size) -lt 50MB) {
      $dv.type = $f.type          # the type that actually worked travels with the device
      $targets += [pscustomobject]@{ disk = $d; dev = $dv }
      break
    }
  }
}
foreach ($dv in $devs) {
  if (@($targets | Where-Object { $_.dev.dev -eq $dv.dev }).Count -gt 0) { continue }
  $f = Get-DeviceFacts -Dev $dv -Bridge $Bridge
  $bytes = $f.bytes
  if ($bytes -le 0) { continue }
  $dv.type = $f.type
  $pseudo = [pscustomobject]@{
    Number = -1; Size = $bytes; PartitionStyle = 'RAW'; BusType = 'USB'
    HealthStatus = 'Unknown'; OperationalStatus = @('Unknown'); IsBoot = $false; IsSystem = $false
    FriendlyName = ''; SerialNumber = ''
  }
  $targets += [pscustomobject]@{ disk = $pseudo; dev = $dv }
}

foreach ($t in $targets) {
  $d = $t.disk
  $match = $t.dev
  $scanBlind = $false
  if ($Disk -ge 0 -and $d.Number -ne $Disk) { continue }
  $devType = if ($Bridge) { $Bridge } else { $match.type }

  $identity = Run-Ctl @('-i', '-H', '-A', '-d', $devType, $match.dev)
  if ($identity.text -notmatch 'Device Model|Model Number|Product:') {
    $devType = 'auto'
    $identity = Run-Ctl @('-i', '-H', '-A', '-d', 'auto', $match.dev)
  }
  $text = $identity.text
  $attrs = Get-Attrs $text

  # identity lines exactly as smartctl prints them: that is the "full device details you can see"
  $identityLines = @()
  foreach ($line in ($text -split "`n")) {
    if ($line -match '^(=== START OF|Copyright|Home page|smartctl \d)') { continue }
    if ($line.Trim() -eq '') { continue }
    if ($line -match '^(ID#|SMART Attributes Data|Vendor Specific|Note:|Warning|If you are)') { continue }
    if ($line -match '^\s*\d{1,3}\s+\S+\s+0x') { continue }        # attribute rows are not identity
    if ($line -match 'SMART Status not supported|Incomplete response|SMART Error Log|SMART Self-test log') { continue }
    if ($line -match '^SMART overall-health self-assessment test result') { continue }
    if ($line.Trim() -eq '=== START OF READ SMART DATA SECTION ===') { continue }
    $identityLines += $line.TrimEnd()
    if ($identityLines.Count -ge 22) { break }
  }

  $model  = [string](($text -split "`n" | Where-Object { $_ -match '^(Device Model|Model Number|Product):' } | Select-Object -First 1) -replace '^[^:]+:\s*','')
  $serial = [string](($text -split "`n" | Where-Object { $_ -match '^Serial [Nn]umber:' } | Select-Object -First 1) -replace '^[^:]+:\s*','')
  $fw     = [string](($text -split "`n" | Where-Object { $_ -match '^(Firmware Version|Revision):' } | Select-Object -First 1) -replace '^[^:]+:\s*','')
  $capTxt = [string](($text -split "`n" | Where-Object { $_ -match '^\s*(User Capacity|Total NVM Capacity):' } | Select-Object -First 1) -replace '^[^:]+:\s*','')
  $health = [string](($text -split "`n" | Where-Object { $_ -match '^SMART overall-health' } | Select-Object -First 1) -replace '^[^:]+:\s*','')

  if ($devType -eq 'nvme') {
    $grab = { param($p) $h = (($text -split "`n") | Where-Object { $_ -match $p } | Select-Object -First 1); if ($h -match '(\d+)') { [int]$matches[1] } else { $null } }
    $attrs['poweron_hours'] = & $grab '^Power On Hours:'
    $attrs['power_cycles']  = & $grab '^Power Cycles:'
    $attrs['media_errors']  = & $grab '^Media and Data Integrity Errors:'
    $attrs['percentage_used'] = & $grab '^Percentage Used:'
  }

  # ---- the Windows side: partition table and volumes
  # -DiskNumber -1 is a parameter-binding error, not something -ErrorAction can swallow: an uninitialised
  # drive has no partition table to read, so it simply has no partitions
  $parts = @()
  if ($d.Number -ge 0) { $parts = @(Get-Partition -DiskNumber $d.Number -ErrorAction SilentlyContinue) }
  $vols = @()
  foreach ($p in $parts) {
    if (-not $p.DriveLetter) { continue }
    $v = Get-Volume -DriveLetter $p.DriveLetter -ErrorAction SilentlyContinue
    if (-not $v) { continue }
    $vols += [pscustomobject]@{
      letter = [string]$p.DriveLetter; label = [string]$v.FileSystemLabel; fs = [string]$v.FileSystem
      size_bytes = [int64]$v.Size; free_bytes = [int64]$v.SizeRemaining
      used_bytes = [int64]($v.Size - $v.SizeRemaining); health = [string]$v.HealthStatus
      drivesize = [string]$v.DriveType
    }
  }

  # ---- is there data on it? bounded, so a 1 TB drive costs seconds, not an hour
  $content = [ordered]@{
    mounted = ($vols.Count -gt 0)
    volumes = $vols.Count
    volumes_detail = @($vols)
    scan_seconds_cap = $ScanSeconds
    scan_truncated = $false
    files = 0
    bytes = [int64]0
    system_bytes_excluded = [int64]0
    volumes_scan = @()
    top_level = @()
    looks_like_windows = $false
    looks_like_media = $false
    looks_like_documents = $false
    note = ''
  }
  if ($NoScan) {
    $content.note = 'not scanned - the data on this drive is not wanted'
    $content.mounted = $false
    $content.volumes = 0
    $content.volumes_detail = @()
    $content.volumes_scan = @()
  } elseif ($vols.Count -gt 0) {
    # EVERY volume, not just the first. A 100 MB "SYSTEM" partition was scanned while a 1.8 TB "Data"
    # volume sat unread, and the sheet called a dying drive holding 1.8 TB "TEST THEN WIPE".
    $sysPattern = '^(?i)(pagefile\.sys|hiberfil\.sys|swapfile\.sys|DumpStack\.log.*|BOOTSECT\.BAK|bootmgr|BOOTNXT)$'
    $sysDirs = @('System Volume Information', '$RECYCLE.BIN', 'Recovery', 'Boot', 'Config.Msi')
    $totalFiles = 0; $totalBytes = [int64]0; $totalSys = [int64]0
    $scanRows = @()
    $biggest = ($vols | Sort-Object used_bytes -Descending | Select-Object -First 1)
    foreach ($vol in $vols) {
      $root = $vol.letter + ':\'
      $top = @(Get-ChildItem -LiteralPath $root -Force -ErrorAction SilentlyContinue |
        Sort-Object { $_.PSIsContainer } -Descending |
        Select-Object -First 12 |
        ForEach-Object {
          $kind = if ($_.PSIsContainer) { 'dir' } else { 'file' }
          $size = if ($_.PSIsContainer) { '' } else { [string]$_.Length }
          "$kind`t$($_.Name)`t$size"
        })
      if ($vol.letter -eq $biggest.letter) {
        $content.top_level = $top
        $names = ($top | ForEach-Object { ($_ -split "`t")[1] }) -join ' '
        $content.looks_like_windows = ($names -match '(?i)\bWindows\b') -or ($names -match '(?i)\bUsers\b')
        $content.looks_like_media = ($names -match '(?i)DCIM|Pictures|Photos|Music|Videos|Movies|Media')
        $content.looks_like_documents = ($names -match '(?i)Documents|Desktop|Downloads|Backup|Archive|Projects|Work')
      }

      $sw = [System.Diagnostics.Stopwatch]::StartNew()
      $files = 0; $bytes = [int64]0; $sysBytes = [int64]0
      $truncated = $false
      $stack = New-Object System.Collections.Stack
      $stack.Push((Get-Item -LiteralPath $root -Force))
      while ($stack.Count -gt 0) {
        if ($sw.Elapsed.TotalSeconds -gt $ScanSeconds) { $truncated = $true; break }
        $dir = $stack.Pop()
        try {
          foreach ($child in [System.IO.Directory]::EnumerateFileSystemEntries($dir.FullName)) {
            if ($sw.Elapsed.TotalSeconds -gt $ScanSeconds) { $truncated = $true; break }
            try {
              $fi = New-Object System.IO.FileInfo $child
              $isDir = [bool]($fi.Attributes -band [System.IO.FileAttributes]::Directory)
              if ($isDir) {
                if ($sysDirs -notcontains $fi.Name) { $stack.Push($fi) }
              } elseif ($fi.Name -match $sysPattern) {
                $sysBytes += $fi.Length
              } else {
                $files++; $bytes += $fi.Length
              }
            } catch { }
          }
        } catch { }
        if ($truncated) { break }
      }
      $scanRows += [pscustomobject]@{ letter = $vol.letter; label = $vol.label; files = $files; bytes = $bytes; system_bytes = $sysBytes; truncated = $truncated }
      $totalFiles += $files; $totalBytes += $bytes; $totalSys += $sysBytes
      if ($truncated) { $content.scan_truncated = $true }
    }
    $content.volumes_scan = @($scanRows)
    $content.files = $totalFiles
    $content.bytes = $totalBytes
    $content.system_bytes_excluded = $totalSys
    # a capped scan that found ~nothing is not evidence of an empty drive: on a drive with pending sectors one
    # stalled directory read eats the whole budget, and 39 files got counted on a volume holding 168 GB
    $usedTotal = [int64]0
    foreach ($v in $vols) { $usedTotal += [int64]$v.used_bytes }
    if ($content.scan_truncated -and $usedTotal -gt 5GB -and $totalBytes -lt ($usedTotal * 0.2)) { $scanBlind = $true }
    if ($totalSys -gt $totalBytes -and $totalSys -gt 1GB) {
      $content.note = ('only {0} of user files; {1} on the volume is a Windows page file / system files' -f (FmtHuman $totalBytes), (FmtHuman $totalSys))
    }
  } else {
    if ($d.Number -lt 0) { $content.note = 'no Windows disk object - uninitialized, blank, or a partition table Windows cannot read' }
    elseif ($d.PartitionStyle -eq 'RAW') { $content.note = 'no partition table - raw device (blank, or a foreign format)' }
    elseif ($parts.Count -eq 0) { $content.note = 'partition table present, no partitions' }
    else { $content.note = 'partitions present, none mountable with a drive letter (foreign or damaged filesystem)' }
  }

  # ---- verdict, rating and pile. Numbers first, then one line of why.
  $pending = $attrs['pending_sectors']; $realloc = $attrs['reallocated']
  $uncorr = $attrs['offline_uncorrectable']; $crc = $attrs['crc_errors']; $hours = $attrs['poweron_hours']
  $mediaErrors = $attrs['media_errors']

  $verdict = 'USABLE'; $why = @()
  if ($health -match 'FAILED') {
    $verdict = 'DEAD'
    $why += $(if ($attrs['failing']) { 'SMART health FAILED on ' + $attrs['failing'] } else { 'SMART health FAILED' })
  }
  if ($pending -gt 0) { $verdict = 'DYING'; $why += "$pending pending sector(s)" }
  if ($uncorr -gt 0) { if ($verdict -eq 'USABLE') { $verdict = 'DYING' }; $why += "$uncorr offline-uncorrectable" }
  # some Travelstar firmwares pack attribute 187 into a meaningless number (3.9 million on a 1,242-hour drive
  # with zero pending and zero reallocated). Say so rather than printing it as if it were a reading.
  if ($attrs['reported_uncorrectable'] -gt 10000 -and $pending -eq 0 -and $realloc -eq 0) {
    $attrs['reported_uncorrectable_note'] = 'raw counter reads implausibly high for a drive with no pending or reallocated sectors - firmware encoding, not 4 million read errors'
  }
  if ($mediaErrors -gt 0) { if ($verdict -eq 'USABLE') { $verdict = 'DYING' }; $why += "$mediaErrors media error(s)" }
  if ($realloc -gt 50) { if ($verdict -eq 'USABLE') { $verdict = 'WORN' }; $why += "$realloc reallocated" }
  if ($crc -gt 0) { $why += "$crc CRC (cable/bridge)" }

  # "has data" must mean DATA, not "a filesystem exists": a retired Windows boot volume holds 95 system
  # files and 20 MB, and calling that RECOVERY ONLY would put a dead drive in the wrong pile forever
  $hasData = ($content.bytes -gt 512MB) -or ($content.files -gt 2000)
  $tinyData = (-not $hasData) -and ($content.files -gt 0)
  if (-not $hasData -and $vols.Count -gt 0 -and $content.files -eq 0 -and $vols[0].used_bytes -lt 512MB) {
    $content.note = 'mounted, no files found - effectively empty'
  }

  $rating = switch ($verdict) {
    'DEAD'   { 'F' }
    'DYING'  { 'D' }
    'WORN'   { 'C' }
    default  { if (($hours -ne $null -and $hours -gt 30000) -or ($crc -gt 0)) { 'B' } else { 'A' } }
  }

  $pile = 'SPARE - EMPTY'
  if ($scanBlind) {
    $pile = 'HOLD - DATA UNKNOWN'
    $why += 'scan was capped before it reached the files'
  }
  elseif ($NoScan) {
    # nobody wants what is on this drive, so the only question is: is the drive worth keeping?
    if ($verdict -eq 'DEAD') { $pile = 'TOSS' }
    elseif ($verdict -eq 'DYING') { $pile = 'TOSS' }
    else { $pile = 'WIPE AND USE' }
  }
  elseif ($verdict -eq 'DEAD' -and $hasData) { $pile = 'RECOVERY ONLY' }
  elseif ($NoScan) { }
  elseif ($verdict -eq 'DEAD') { $pile = 'E-WASTE' }
  elseif ($verdict -eq 'DYING' -and $hasData) { $pile = 'IMAGE FIRST' }
  elseif ($verdict -eq 'DYING') {
    # a drive with nothing on it and sectors it cannot read is not a wipe candidate - there is no data to
    # sanitise and no future to wipe it for
    $pile = if (($pending -gt 0) -or ($uncorr -gt 0)) { 'E-WASTE' } else { 'TEST THEN WIPE' }
  }
  elseif ($verdict -eq 'WORN' -and $hasData) { $pile = 'COPY OFF, THEN SCRATCH' }
  elseif ($verdict -eq 'WORN') { $pile = 'SCRATCH ONLY' }
  elseif ($hasData) { $pile = 'HOLD - HAS DATA' }
  elseif ($tinyData) { $pile = 'SPARE - TINY DATA' }
  else { $pile = 'SPARE - EMPTY' }

  $report = [ordered]@{
    at = (Get-Date -Format 's')
    node = $env:COMPUTERNAME
    disk_number = $d.Number
    device = [ordered]@{
      path = $match.dev
      type = $devType
      model = $model
      serial = $serial
      firmware = $fw
      capacity_text = $capTxt
      capacity_bytes = [int64]$d.Size
      bus = [string]$d.BusType
      partition_style = [string]$d.PartitionStyle
      partitions = $parts.Count
      health_status = [string]$d.HealthStatus
      operational = [string]$d.OperationalStatus
      is_boot = [bool]$d.IsBoot
      is_system = [bool]$d.IsSystem
    }
    smart = [ordered]@{
      health = $health
      power_on_hours = $hours
      power_cycles = $attrs['power_cycles']
      temperature = $(if ($null -ne $attrs['temperature']) { $attrs['temperature'] } else { $attrs['air_temp_max'] })
      pending = $pending
      reallocated = $realloc
      offline_uncorrectable = $uncorr
      crc = $crc
      reported_uncorrectable = $attrs['reported_uncorrectable']
      reported_uncorrectable_note = $attrs['reported_uncorrectable_note']
      failing_attribute = $attrs['failing']
      load_cycles = $attrs['load_cycles']
      life_left_pct = $attrs['life_left_pct']
      flash_writes_gib = $attrs['flash_writes_gib']
      erase_cycles = $attrs['erase_cycles']
      unsafe_shutdowns = $attrs['unsafe_shutdowns']
      bad_block_rate = $attrs['bad_block_rate']
      media_errors = $mediaErrors
    }
    identity_lines = $identityLines
    content = $content
    verdict = $verdict
    rating = $rating
    pile = $pile
    why = ($why -join '; ')
  }

  $safe = ($serial -replace '[^\w.-]', '') ; if (-not $safe) { $safe = 'disk' + $d.Number }
  $suffix = if ($d.Number -ge 0) { $d.Number } else { 'x' }
  $path = Join-Path $Out ("disk-{0}-{1}.json" -f $safe, $suffix)
  ($report | ConvertTo-Json -Depth 8) | Set-Content -Path $path -Encoding UTF8
  $reports += [pscustomobject]@{ path = $path; model = $model; serial = $serial; verdict = $verdict; rating = $rating; pile = $pile; has_data = $hasData }
}

$reports | Format-Table -AutoSize | Out-String | Write-Output
'reports written: ' + $reports.Count + ' to ' + $Out
