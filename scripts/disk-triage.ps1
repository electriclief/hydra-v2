# =====================================================================================
#  disk-triage.ps1 - "is this disk dead?" in about two minutes, per disk, read-only.
#
#  Built for a pile of loose SATA drives on a USB bridge. It never writes to the disk: no
#  format, no wipe, no chkdsk /r (that is the multi-hour surface scan). It reads SMART,
#  optionally runs the drive's own SHORT self-test (~2 min), and states a verdict with the
#  numbers that produced it. Every run appends one line to the log CSV, so ten disks become
#  a table instead of ten memories.
#
#  Usage (as Administrator):
#    powershell -File disk-triage.ps1                 # instant: identity + SMART + verdict
#    powershell -File disk-triage.ps1 -ShortTest      # adds the drive's 2-minute self-test
#    powershell -File disk-triage.ps1 -QuickRead      # adds a bounded read of head/middle/tail
#    powershell -File disk-triage.ps1 -Bridge sat,12  # force a USB bridge type for every disk
# =====================================================================================
param(
  [switch]$ShortTest,
  [switch]$QuickRead,
  [string]$Bridge = '',
  [string]$Log = 'C:\AI\reports\hdd-log.csv',
  [string]$SmartCtl = 'C:\Program Files\smartmontools\bin\smartctl.exe'
)
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force (Split-Path -Parent $Log) | Out-Null

if (-not (Test-Path $SmartCtl)) {
  foreach ($cand in @('C:\Program Files\smartmontools\bin64\smartctl.exe', 'C:\Program Files (x86)\smartmontools\bin\smartctl.exe')) {
    if (Test-Path $cand) { $SmartCtl = $cand; break }
  }
}
if (-not (Test-Path $SmartCtl)) { throw "smartctl not found - install smartmontools first" }

function Run-SmartCtl {
  param([string[]]$Arguments)
  $out = & $SmartCtl @Arguments 2>&1
  return @{ code = $LASTEXITCODE; text = ($out -join "`n") }
}

# SMART attribute number -> what it means for a used drive. Only these are read for the verdict.
$ATTR = @{
  '5'   = 'reallocated'
  '9'   = 'poweron_hours'
  '187' = 'reported_uncorrectable'
  '188' = 'command_timeouts'
  '196' = 'reallocation_events'
  '197' = 'pending_sectors'
  '198' = 'offline_uncorrectable'
  '199' = 'crc_errors'
  '193' = 'load_cycles'
  '231' = 'life_left_pct'
}

function Get-AttrMap {
  param([string]$Text)
  $map = @{}
  foreach ($line in ($Text -split "`n")) {
    # "  5 Reallocated_Sector_Ct   0x0033   200   200   140    Pre-fail  Always       -       12"
    # the RAW_VALUE is the LAST field, and it can be "-", "12", "3 (Average 1)" or "1/2" - take the first integer
    $trimmed = $line.Trim()
    if ($trimmed -notmatch '^(\d{1,3})\s+(\S+)\s+0x[0-9a-fA-F]+\s') { continue }
    $id = $matches[1]
    if (-not $ATTR.ContainsKey($id)) { continue }
    $fields = @($trimmed -split '\s+')
    $rawField = $fields[$fields.Count - 1]
    $num = 0
    if ([int]::TryParse(($rawField -replace '[^0-9].*$', ''), [ref]$num)) { $map[$ATTR[$id]] = $num }
  }
  return $map
}

# ---- which devices exist. --scan-open is smartctl's own answer, so no guessing about naming.
$scan = Run-SmartCtl @('--scan-open')
$devices = @()
foreach ($line in ($scan.text -split "`n")) {
  if ($line -match '^(/dev/\S+)\s+-d\s+(\S+)') { $devices += [pscustomobject]@{ dev = $matches[1]; type = $matches[2] } }
}
if (-not $devices.Count) { 'no devices found by smartctl --scan-open'; return }

# ---- physical disks, for size/serial/bus alongside the SMART answer
$phys = @{}
foreach ($d in (Get-Disk | Where-Object { $_.BusType -ne $null })) {
  $phys[$d.Number] = $d
}

$results = @()
foreach ($device in $devices) {
  $devType = if ($Bridge) { $Bridge } else { $device.type }
  '==================== {0}   (-d {1})' -f $device.dev, $devType

  $ident = Run-SmartCtl @('-i', '-H', '-A', '-d', $devType, $device.dev)
  $text = $ident.text

  # scalars, always: a pattern that matches twice returns an array, and -f on an array is a crash in a report
  $model  = [string]((($text -split "`n") | Where-Object { $_ -match '^(Device Model|Model Number|Product):' } | Select-Object -First 1) -replace '^[^:]+:\s*', '')
  $serial = [string]((($text -split "`n") | Where-Object { $_ -match '^Serial [Nn]umber:' } | Select-Object -First 1) -replace '^[^:]+:\s*', '')
  $cap    = [string]((($text -split "`n") | Where-Object { $_ -match '^\s*(User Capacity|Total NVM Capacity|Namespace 1 Size/Capacity):' } | Select-Object -First 1) -replace '^[^:]+:\s*', '')
  $health = [string]((($text -split "`n") | Where-Object { $_ -match '^SMART overall-health' } | Select-Object -First 1) -replace '^[^:]+:\s*', '')
  $attrs  = Get-AttrMap $text

  if ($devType -eq 'nvme') {
    $num = { param($pat) $hit = (($text -split "`n") | Where-Object { $_ -match $pat } | Select-Object -First 1); if ($hit -match '(\d+)') { [int]$matches[1] } else { $null } }
    $attrs['poweron_hours'] = & $num '^Power On Hours:'
    $attrs['life_left_pct'] = (& $num '^Percentage Used:') | ForEach-Object { if ($_ -ne $null) { 100 - $_ } }
    $attrs['media_errors']  = & $num '^Media and Data Integrity Errors:'
  }

  $pending   = if ($attrs.ContainsKey('pending_sectors')) { $attrs['pending_sectors'] } else { $null }
  $realloc   = if ($attrs.ContainsKey('reallocated')) { $attrs['reallocated'] } else { $null }
  $uncorr    = if ($attrs.ContainsKey('offline_uncorrectable')) { $attrs['offline_uncorrectable'] } else { $null }
  $hours     = if ($attrs.ContainsKey('poweron_hours')) { $attrs['poweron_hours'] } else { $null }
  $crc       = if ($attrs.ContainsKey('crc_errors')) { $attrs['crc_errors'] } else { $null }

  # ---- the verdict: numbers first, adjectives after
  $verdict = 'USABLE'
  $why = @()
  if ($health -match 'FAILED') { $verdict = 'DEAD'; $why += 'SMART health FAILED' }
  if ($pending -ne $null -and $pending -gt 0) { $verdict = 'DYING'; $why += "$pending pending sector(s) - unreadable now" }
  if ($uncorr -ne $null -and $uncorr -gt 0) {
    if ($verdict -eq 'USABLE') { $verdict = 'DYING' }
    $why += "$uncorr offline-uncorrectable"
  }
  if ($attrs.ContainsKey('media_errors') -and $attrs['media_errors'] -gt 0) {
    if ($verdict -eq 'USABLE') { $verdict = 'DYING' }
    $why += "$($attrs['media_errors']) media/data-integrity error(s) reported by the NVMe controller"
  }
  if ($realloc -ne $null -and $realloc -gt 50) {
    if ($verdict -eq 'USABLE') { $verdict = 'WORN' }
    $why += "$realloc reallocated sectors"
  }
  if ($crc -ne $null -and $crc -gt 0) { $why += "$crc CRC errors (cable/bridge - not the platters)" }
  if ($health -match 'FAILED' -and -not $why) { $why += 'health failed' }

  $selftest = ''
  if ($ShortTest) {
    '  running the drive''s short self-test (about 2 minutes)...'
    $t = Run-SmartCtl @('-t', 'short', '-d', $devType, $device.dev)
    $deadline = (Get-Date).AddMinutes(4)
    $state = 'unknown'
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Seconds 20
      $res = Run-SmartCtl @('-l', 'selftest', '-d', $devType, $device.dev)
      $line = ($res.text -split "`n") | Where-Object { $_ -match '^#\s*1\s+' } | Select-Object -First 1
      if ($line) {
        $selftest = ($line -replace '\s+', ' ').Trim()
        if ($line -match 'Completed without error') { $state = 'passed'; break }
        if ($line -match 'read failure|electrical failure|servo|Unknown error|Aborted') { $state = 'failed'; break }
        if ($line -match 'in progress') { continue }
      }
      if ($t.code -and $t.text -match 'does not support') { $selftest = 'not supported by this drive'; break }
    }
    if (-not $selftest) { $selftest = 'no result within 4 minutes' }
    '  self-test: {0}' -f $selftest
    if ($state -eq 'failed' -and $verdict -eq 'USABLE') { $verdict = 'DYING'; $why += 'self-test failed' }
  }

  $readTest = ''
  if ($QuickRead) {
    # 48 MB at the start, 29% in, and at the end: enough to catch a head that cannot read, in seconds.
    # The drive is matched by CAPACITY, because /dev/sdN is smartctl's own numbering and does not always
    # line up with PhysicalDrive N - reading the wrong disk here would be a catastrophic mistake.
    '  quick read (48 MB at start, 29%, end)'
    $capBytes = 0
    if ($cap -match '([\d,]+)\s+bytes') { $capBytes = [int64](($matches[1]) -replace ',', '') }
    $target = $null
    if ($capBytes -gt 0) {
      $target = Get-Disk | Where-Object { [math]::Abs([int64]$_.Size - $capBytes) -lt 50MB } | Select-Object -First 1
    }
    $readTest = 'skipped (cannot map this device to a PhysicalDrive: size unknown or ambiguous)'
    if ($target) {
      $fs = $null
      try {
        $fs = [System.IO.File]::Open("\\.\PhysicalDrive$($target.Number)", [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $len = $fs.Length
        $buf = New-Object byte[] (48MB)
        $offsets = @(0, [int64]($len * 0.29), [int64]([math]::Max(0, $len - 48MB)))
        $fail = 0
        foreach ($off in $offsets) {
          $fs.Seek([int64]$off, [System.IO.SeekOrigin]::Begin) | Out-Null
          try { [void]$fs.Read($buf, 0, $buf.Length) } catch { $fail++ }
        }
        $readTest = if ($fail) { "$fail of 3 windows unreadable" } else { 'all 3 windows read clean' }
      } catch { $readTest = 'could not open: ' + $_.Exception.Message } finally { if ($fs) { $fs.Close() } }
    }
    '  read: {0}' -f $readTest
    if ($readTest -match 'unreadable' -and $verdict -eq 'USABLE') { $verdict = 'DYING'; $why += 'read failures outside SMART' }
  }

  $row = [pscustomobject]@{
    at = (Get-Date -Format 's')
    device = $device.dev
    type = $devType
    model = $model
    serial = $serial
    capacity = $cap
    health = $health
    hours = $hours
    reallocated = $realloc
    pending = $pending
    offline_uncorrectable = $uncorr
    crc = $crc
    selftest = $selftest
    quickread = $readTest
    verdict = $verdict
    why = ($why -join '; ')
  }
  $results += $row

  ''
  '  model     {0}' -f $model
  '  serial    {0}' -f $serial
  '  capacity  {0}' -f $cap
  '  health    {0}' -f $health
  '  hours     {0}' -f $hours
  '  attrs     reallocated={0}  pending={1}  offline_uncorrectable={2}  crc={3}' -f $realloc, $pending, $uncorr, $crc
  ''
  '  VERDICT   {0}{1}' -f $verdict, $(if ($why.Count) { '  (' + ($why -join '; ') + ')' } else { '' })
  ''
}

# ---- append, never overwrite: ten disks are a table, and the table is the point
$new = -not (Test-Path $Log)
$results | Export-Csv -Path $Log -NoTypeInformation -Append -Encoding UTF8
if ($new) { 'log started: ' + $Log } else { 'appended {0} row(s) to {1}' -f $results.Count, $Log }

''
'== session summary'
$results | Select-Object verdict, model, serial, hours, pending, reallocated | Format-Table -AutoSize | Out-String | Write-Output
'verdicts: ' + (($results | Group-Object verdict | ForEach-Object { "$($_.Name)=$($_.Count)" }) -join '  ')
