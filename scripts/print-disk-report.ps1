# =====================================================================================
#  print-disk-report.ps1 - one page per drive, facts only, printed one-sided to the Brother.
#
#  Reads the JSON that disk-facts.ps1 produced on the machine the drive is plugged into, and
#  draws a single sheet: identity as smartctl prints it, the health counters, the partition
#  and volume table, what is actually ON the drive, then a rating and a pile.
#
#  Usage:
#    powershell -File print-disk-report.ps1 -Json "C:\AI\reports\disk-facts\disk-WD-XYZ-2.json"
#    powershell -File print-disk-report.ps1 -All                      # every json in the folder
#    powershell -File print-disk-report.ps1 -All -DryRun               # render pngs, print nothing
# =====================================================================================
param(
  [string]$Json = '',      # a STRING: powershell -File joins a comma list into one argument before the script sees it
  [switch]$All,
  [string]$Folder = 'C:\AI\reports\disk-facts',
  [string]$OutDir = 'C:\AI\reports\disks',
  [string]$Printer = 'Brother DCP-L2550DW',
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force $OutDir | Out-Null

$paths = @()
if ($All) {
  $paths = @(Get-ChildItem (Join-Path $Folder '*.json') | Sort-Object Name | Select-Object -ExpandProperty FullName)
} elseif ($Json) {
  $paths = @($Json -split '[,;]' | ForEach-Object { $_.Trim().Trim('"') } | Where-Object { $_ })
}
if (-not $paths.Count) { throw 'no JSON given: use -Json <path>[,<path>] or -All' }

$docs = @()
foreach ($path in $paths) {
  $raw = Get-Content -LiteralPath $path -Raw
  $docs += ($raw | ConvertFrom-Json)
}
$total = $docs.Count

function Fmt-Bytes {
  param($b)
  if ($null -eq $b -or ($b -is [string] -and $b -eq '')) { return '-' }
  $v = [double]$b
  if ($v -ge 1TB) { return ('{0:0.00} TB' -f ($v / 1TB)) }
  if ($v -ge 1GB) { return ('{0:0.0} GB' -f ($v / 1GB)) }
  if ($v -ge 1MB) { return ('{0:0.0} MB' -f ($v / 1MB)) }
  return ('{0} B' -f [int64]$v)
}
function Fmt-Num {
  param($n, [string]$Unit = '')
  if ($null -eq $n -or ($n -is [string] -and $n -eq '')) { return '-' }
  ('{0:N0}{1}' -f [int64]$n, $Unit)
}

function Draw-Report {
  param([System.Drawing.Graphics]$g, $d, [int]$index, [int]$of)

  $F = { param($sz, $style) [System.Drawing.Font]::new('Segoe UI', [single]$sz, $style, [System.Drawing.GraphicsUnit]::Point) }
  $MonoFactory = { param($sz) [System.Drawing.Font]::new('Consolas', [single]$sz, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Point) }

  $pageW = 850; $pageH = 1100
  $L = 54; $W = $pageW - 108
  $grey = [System.Drawing.Color]::FromArgb(110, 110, 110)
  $line = [System.Drawing.Color]::FromArgb(224, 224, 224)
  $g.Clear([System.Drawing.Color]::White)

  $label = & $F 8 ([System.Drawing.FontStyle]::Bold)
  $body  = & $F 10.5 ([System.Drawing.FontStyle]::Regular)
  $small = & $F 8.5 ([System.Drawing.FontStyle]::Regular)
  $mono  = & $MonoFactory 9
  $y = 46

  # ---- masthead
  $g.DrawString(('DISK REPORT   .   {0}   .   {1}' -f $d.node, ($d.at -replace 'T', ' ')), $label, [System.Drawing.SolidBrush]::new($grey), [single]$L, [single]$y)
  $g.DrawString(('{0} / {1}' -f $index, $of), $label, [System.Drawing.SolidBrush]::new($grey), [single]($L + $W - 40), [single]$y)
  $y += 20

  # ---- model, shrunk until it fits two lines
  $titleFont = & $F 25 ([System.Drawing.FontStyle]::Bold)
  while ($titleFont.Size -gt 13) {
    $meas = $g.MeasureString($d.device.model, $titleFont, [System.Drawing.SizeF]::new([single]$W, [single]10000))
    if ($meas.Height -le ($titleFont.GetHeight($g) * 2.2)) { break }
    $next = [double]$titleFont.Size - 1
    $titleFont.Dispose()
    $titleFont = & $F $next ([System.Drawing.FontStyle]::Bold)
  }
  $tRect = [System.Drawing.RectangleF]::new([single]$L, [single]$y, [single]$W, [single]120)
  $g.DrawString([string]$d.device.model, $titleFont, [System.Drawing.Brushes]::Black, $tRect, [System.Drawing.StringFormat]::GenericTypographic)
  $ys = $g.MeasureString([string]$d.device.model, $titleFont, [System.Drawing.SizeF]::new([single]$W, [single]10000))
  $y += [int]$ys.Height + 4

  $g.DrawString(('serial {0}   .   {1}   .   {2}   .   {3} {4}' -f $d.device.serial, $d.device.capacity_text, $d.device.bus,
      $d.device.type, $d.device.path), $small, [System.Drawing.SolidBrush]::new($grey), [single]$L, [single]$y)
  $y += 22

  # ---- the rating bar: one line a person reads from across the bench
  $barH = 46
  $g.FillRectangle([System.Drawing.Brushes]::Black, [single]$L, [single]$y, [single]$W, [single]$barH)
  $rateFont = & $F 22 ([System.Drawing.FontStyle]::Bold)
  $g.DrawString([string]$d.rating, $rateFont, [System.Drawing.Brushes]::White, [single]($L + 14), [single]($y + 8))
  $vd = & $F 13 ([System.Drawing.FontStyle]::Bold)
  $g.DrawString(([string]$d.verdict), $vd, [System.Drawing.Brushes]::White, [single]($L + 56), [single]($y + 13))
  $pileFont = & $F 16 ([System.Drawing.FontStyle]::Bold)
  while ($pileFont.Size -gt 9 -and $g.MeasureString([string]$d.pile, $pileFont).Width -gt ($W - 240)) {
    $next = [double]$pileFont.Size - 0.5
    $pileFont.Dispose(); $pileFont = & $F $next ([System.Drawing.FontStyle]::Bold)
  }
  $pw = $g.MeasureString([string]$d.pile, $pileFont).Width
  $g.DrawString([string]$d.pile, $pileFont, [System.Drawing.Brushes]::White, [single]($L + $W - $pw - 16), [single]($y + 12))
  $y += $barH + 8

  $action = switch -Wildcard ([string]$d.pile) {
    'IMAGE FIRST'          { 'Do not use this drive. Image it to another disk first, then decide what to keep.' }
    'RECOVERY ONLY'        { 'Do not write to this drive and do not run repair tools. Copy what is needed, then retire it.' }
    'E-WASTE'              { 'Nothing worth keeping on it. Wipe for destruction or recycle; do not put it in service.' }
    'TEST THEN WIPE'       { 'No files found, but the drive is failing. Confirm with a short test, then wipe or recycle.' }
    'TOSS'                 { 'Not worth keeping. Wipe only if the old contents matter for privacy, then recycle it.' }
    'WIPE AND USE'         { 'Healthy enough to wipe and put back in service.' }
    'COPY OFF, THEN SCRATCH'{ 'Usable but worn: copy anything important off, then keep it for scratch only.' }
    'SCRATCH ONLY'         { 'Worn, healthy for now: scratch or downloads only, never the only copy.' }
    'HOLD - HAS DATA'      { 'Healthy and contains data: read it, back up what matters, then decide whether to wipe.' }
    'SPARE - TINY DATA'    { 'Essentially empty: a few small user files remain. Check those folders, then wipe and use it.' }
    default                { 'Healthy and empty: ready to use.' }
  }
  $hrs = $d.smart.power_on_hours
  if ($null -ne $hrs -and [double]$hrs -gt 50000 -and $d.pile -notmatch 'TOSS|E-WASTE') {
    $action += (' It has {0:0.0} years of runtime: scratch or spare at best, never the only copy of anything.' -f ([double]$hrs / 8766))
  }
  if ($d.pile -match 'TOSS|E-WASTE' -and $d.why) { $action += ' Reason: ' + $d.why + '.' }
  $actFont = & $F 9.5 ([System.Drawing.FontStyle]::Regular)
  $g.DrawString($action, $actFont, [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(40, 40, 40)), [single]$L, [single]$y)
  $y += 24
  $g.DrawString('box / pile label:', $small, [System.Drawing.SolidBrush]::new($grey), [single]$L, [single]$y)
  $g.DrawLine([System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(150, 150, 150), 1), [single]($L + 96), [single]($y + 12), [single]($L + 330), [single]($y + 12))
  $y += 26

  function Section($g, [string]$text, [ref]$yy, $labelFont, $greyColor) {
    $g.DrawString($text, $labelFont, [System.Drawing.SolidBrush]::new($greyColor), [single]54, [single]$yy.Value)
    $yy.Value += 16
  }

  $yy = $y
  # ---- identity, exactly as smartctl prints it
  Section $g 'DEVICE - as the drive reports itself' ([ref]$yy) $label $grey
  foreach ($idLine in ($d.identity_lines | Select-Object -First 16)) {
    $g.DrawString([string]$idLine, $mono, [System.Drawing.Brushes]::Black, [single]$L, [single]$yy)
    $yy += 14
  }
  $yy += 8

  # ---- health counters, two columns
  Section $g 'HEALTH COUNTERS' ([ref]$yy) $label $grey
  $s = $d.smart
  $pairs = @(
    @('overall health', [string]$s.health),
    @('power-on hours', $(if ($s.power_on_hours -ne $null -and $s.power_on_hours -ne '') { '{0}  ({1:0.0} yr)' -f (Fmt-Num $s.power_on_hours), ([double]$s.power_on_hours / 8766) } else { '-' })),
    @('power cycles', (Fmt-Num $s.power_cycles)),
    @('temperature', $(if ($null -ne $s.temperature -and [double]$s.temperature -gt 0) { "$($s.temperature) C" } else { 'not reported' })),
    @('pending sectors', (Fmt-Num $s.pending)),
    @('reallocated', (Fmt-Num $s.reallocated)),
    @('offline uncorrectable', (Fmt-Num $s.offline_uncorrectable)),
    @('reported uncorrectable', (Fmt-Num $s.reported_uncorrectable)),
    @('CRC / cable errors', (Fmt-Num $s.crc)),
    @('head load cycles', (Fmt-Num $s.load_cycles))
  )
  # an SSD has no sectors to remap and no heads to load: its wear is life left and bytes written, so show those
  # instead of a column of dashes that reads like "not measured"
  if ($null -ne $s.life_left_pct -or $null -ne $s.flash_writes_gib) {
    $pairs = @(
      @('overall health', [string]$s.health),
      @('power-on hours', $(if ($null -ne $s.power_on_hours) { '{0}  ({1:0.0} yr)' -f (Fmt-Num $s.power_on_hours), ([double]$s.power_on_hours / 8766) } else { '-' })),
      @('power cycles', (Fmt-Num $s.power_cycles)),
      @('temperature', $(if ($null -ne $s.temperature -and [double]$s.temperature -gt 0) { "$($s.temperature) C" } else { 'not reported' })),
      @('ssd life left', $(if ($null -ne $s.life_left_pct) { "$($s.life_left_pct) %" } else { '-' })),
      @('written (flash)', $(if ($null -ne $s.flash_writes_gib) { '{0:N0} GiB' -f $s.flash_writes_gib } else { '-' })),
      @('avg erase cycles', (Fmt-Num $s.erase_cycles)),
      @('unsafe shutdowns', (Fmt-Num $s.unsafe_shutdowns)),
      @('bad block rate', (Fmt-Num $s.bad_block_rate)),
      @('CRC / cable errors', (Fmt-Num $s.crc))
    )
  }
  if ($null -ne $s.media_errors -and $s.media_errors -ne '') { $pairs += ,@('media errors (NVMe)', (Fmt-Num $s.media_errors)) }
  $col = 0
  foreach ($pair in $pairs) {
    $cx = $L + ($col * 380)
    $g.DrawString($pair[0], $body, [System.Drawing.SolidBrush]::new($grey), [single]$cx, [single]$yy)
    $g.DrawString($pair[1], $mono, [System.Drawing.Brushes]::Black, [single]($cx + 160), [single]$yy)
    if ($col -eq 1) { $yy += 17; $col = 0 } else { $col = 1 }
  }
  if ($s.reported_uncorrectable_note) {
    $yy += 2
    $g.DrawString($s.reported_uncorrectable_note, $small, [System.Drawing.SolidBrush]::new($grey), [single]$L, [single]$yy)
    $yy += 14
  }
  if ($col -eq 1) { $yy += 17 }
  $yy += 10

  # ---- partitions and volumes
  Section $g 'PARTITIONS AND VOLUMES' ([ref]$yy) $label $grey
  $tableLine = if ($d.device.partition_style -eq 'RAW' -and [int]$d.device.partitions -eq 0) {
    'partition table: none readable by Windows (never initialised, or a foreign format)'
  } else {
    ('table {0}   .   {1} partition(s)   .   windows health {2}   .   operational {3}' -f $d.device.partition_style, $d.device.partitions, $d.device.health_status, ($d.device.operational -join ', '))
  }
  $g.DrawString($tableLine, $body, [System.Drawing.Brushes]::Black, [single]$L, [single]$yy)
  $yy += 17
  if ($d.content.volumes -gt 0 -and $d.content.volumes_detail) {
    $g.DrawString('vol   label              filesystem      size        used        free', $mono, [System.Drawing.SolidBrush]::new($grey), [single]$L, [single]$yy)
    $yy += 14
    foreach ($v in $d.content.volumes_detail) {
      $rowTxt = ('{0}:    {1,-18} {2,-14} {3,-11} {4,-11} {5}' -f $v.letter, $v.label, $v.fs, (Fmt-Bytes $v.size_bytes), (Fmt-Bytes $v.used_bytes), (Fmt-Bytes $v.free_bytes))
      $g.DrawString($rowTxt, $mono, [System.Drawing.Brushes]::Black, [single]$L, [single]$yy)
      $yy += 14
    }
    if ($d.content.volumes_scan) {
      $scanBits = @()
      foreach ($vs in $d.content.volumes_scan) {
        $scanBits += ('{0}: {1} file(s), {2}{3}' -f $vs.letter, (Fmt-Num $vs.files), (Fmt-Bytes $vs.bytes), $(if ($vs.truncated) { ' (capped)' } else { '' }))
      }
      $g.DrawString(('files by volume   ' + ($scanBits -join '   .   ')), $small, [System.Drawing.SolidBrush]::new($grey), [single]$L, [single]$yy)
      $yy += 14
    }
  } else {
    $why = if ($d.content.note -like '*not scanned*') { 'volumes not examined - data on this drive is not wanted' } else { $d.content.note + ' - no volume to enumerate' }
    $g.DrawString($why, $body, [System.Drawing.Brushes]::Black, [single]$L, [single]$yy)
    $yy += 17
  }
  $yy += 10

  # ---- what is on it
  Section $g 'CONTENT - what is actually on it' ([ref]$yy) $label $grey
  $contentLine = if ($d.content.note -like '*not scanned*') {
    'contents not examined - this drive is graded on its health alone (data not wanted)'
  } elseif ([int]$d.content.volumes -eq 0) {
    'no volume mounted - there is no filesystem here to count'
  } elseif ($d.content.scan_truncated) {
    '{0} file(s), {1} at least (scan stopped at the time cap)' -f (Fmt-Num $d.content.files), (Fmt-Bytes $d.content.bytes)
  } else {
    '{0} file(s), {1} - fully counted' -f (Fmt-Num $d.content.files), (Fmt-Bytes $d.content.bytes)
  }
  $g.DrawString($contentLine, $body, [System.Drawing.Brushes]::Black, [single]$L, [single]$yy)
  $yy += 17
  $flags = @()
  if ($d.content.looks_like_windows) { $flags += 'windows install' }
  if ($d.content.looks_like_documents) { $flags += 'documents/work' }
  if ($d.content.looks_like_media) { $flags += 'photos/video/music' }
  if ($flags.Count) {
    $g.DrawString(('looks like: ' + ($flags -join ' + ')), $body, [System.Drawing.Brushes]::Black, [single]$L, [single]$yy)
    $yy += 17
  }
  $tops = @($d.content.top_level | Select-Object -First 10)
  if ($tops.Count) {
    $g.DrawString('top level:', $small, [System.Drawing.SolidBrush]::new($grey), [single]$L, [single]$yy)
    $yy += 14
    foreach ($t in $tops) {
      $parts = $t -split "`t"
      $kind = if ($parts[0] -eq 'dir') { '  dir' } else { ' file' }
      $sz = if ($parts.Count -gt 2 -and $parts[2]) { '   ' + (Fmt-Bytes ([int64]$parts[2])) } else { '' }
      $g.DrawString(($kind + '  ' + $parts[1] + $sz), $mono, [System.Drawing.Brushes]::Black, [single]($L + 8), [single]$yy)
      $yy += 13
    }
  }
  if ($d.content.note -and [int]$d.content.volumes -gt 0) {   # an unmounted drive already said it above
    $g.DrawString(('note: ' + $d.content.note), $small, [System.Drawing.SolidBrush]::new($grey), [single]$L, [single]$yy)
    $yy += 14
  }

  # ---- why, and the footer
  if ($d.why) {
    $yy += 6
    $g.DrawString(('RATED {0} BECAUSE   {1}' -f $d.rating, $d.why), $label, [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(160, 60, 40)), [single]$L, [single]$yy)
  }
  $foot = & $F 7.5 ([System.Drawing.FontStyle]::Regular)
  $g.DrawString(('facts only - nothing was written to this drive . smartctl + windows disk tables . {0}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm')), $foot, [System.Drawing.SolidBrush]::new($grey), [single]$L, [single]($pageH - 34))
}

# (the volume table is read straight from the JSON; if a report has no volumes_detail the row loop
#  simply prints nothing, which the guard below already handles)

$script:idx = 0
if ($DryRun) {
  foreach ($d in $docs) {
    $script:idx++
    $bmp = [System.Drawing.Bitmap]::new(850, 1100)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
    Draw-Report -g $g -d $d -index $script:idx -of $total
    $safe = ([string]$d.device.serial -replace '[^\w.-]', '')
    $out = Join-Path $OutDir ('disk-{0}.png' -f $(if ($safe) { $safe } else { 'x' + $script:idx }))
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    'rendered ' + $out
  }
  'DRY RUN - {0} page(s) rendered, nothing printed.' -f $total
  return
}

$doc = [System.Drawing.Printing.PrintDocument]::new()
$doc.PrinterSettings.PrinterName = $Printer
if (-not $doc.PrinterSettings.IsValid) { throw "printer not usable: $Printer" }
$doc.DefaultPageSettings.Landscape = $false
$doc.DefaultPageSettings.Margins = [System.Drawing.Printing.Margins]::new(30, 30, 30, 30)
try { $doc.DefaultPageSettings.Duplex = [System.Drawing.Printing.Duplex]::Simplex } catch { }
$paper = $doc.DefaultPageSettings.PaperSize
'printer {0} . paper {1} {2}x{3}' -f $Printer, $paper.PaperName, $paper.Width, $paper.Height

# ONE JOB PER DRIVE: a sheet goes in the pile next to its own disk, and two drives on one sheet
# is the mistake this project already made once with the card tags.
$script:job = 0
foreach ($d in $docs) {
  $script:job++
  $script:idx = $script:job
  $one = [System.Drawing.Printing.PrintDocument]::new()
  $one.PrinterSettings.PrinterName = $Printer
  $one.DefaultPageSettings.Landscape = $false
  $one.DefaultPageSettings.Margins = [System.Drawing.Printing.Margins]::new(30, 30, 30, 30)
  try { $one.DefaultPageSettings.Duplex = [System.Drawing.Printing.Duplex]::Simplex } catch { }
  $one.add_PrintPage({
    param($sender, $e)
    $e.Graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
    $e.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    Draw-Report -g $e.Graphics -d $docs[$script:idx - 1] -index $script:idx -of $total
    $e.HasMorePages = $false
  })
  $one.Print()
  'sent: {0}  ({1} {2})' -f $d.device.model, $d.rating, $d.pile
  Start-Sleep -Seconds 2
}

Start-Sleep -Seconds 6
$jobs = @(Get-PrintJob -PrinterName $Printer -ErrorAction SilentlyContinue)
'jobs still queued: ' + $jobs.Count
if ($jobs.Count) { $jobs | Select-Object Id, JobStatus, Size | Format-Table -AutoSize | Out-String }
else { 'queue empty = accepted and flushed to the engine' }
