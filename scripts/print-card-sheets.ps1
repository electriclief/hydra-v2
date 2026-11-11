# =====================================================================================
#  print-card-sheets.ps1 - one printed page per GPU, to sit with the card on the bench.
#
#  The sheet is a TAG, not a report: name, the verdict in a black bar, what it is good for,
#  what it cannot do, and a ruled area to write the PCI id / driver / measured tokens per
#  second once the card is in a box. Nine cards, nine pages.
#
#  Usage: powershell -NoProfile -File print-card-sheets.ps1 [-DryRun] [-Printer "name"]
#         -DryRun renders page-1.png .. page-9.png to C:\AI\reports\cards and prints nothing.
# =====================================================================================
param(
  [string]$Printer = 'Brother DCP-L2550DW',
  [switch]$DryRun,
  [string]$Only = ''      # e.g. -Only 2  or  -Only 2,3 : send just those card numbers. A string, because
                          # powershell -File joins a comma list into one argument before the script ever sees it.
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$cards = @(
  @{ n = 1
     name = 'XFX Radeon HD 5450'
     vram = '1 GB DDR3'; die = 'Cedar - Terascale 2'; year = '2010'
     vulkan = 'NO'; verdict = 'DISPLAY ONLY - this is the rig''s video out'
     sticker = @('PN    HD-545X-ZQH  (VH.2)', 'SN    08Y016437', 'PCB   110317ZLD  .  VPEACEDAR4PS4')
     can = @('Drives the monitor at up to 2560x1600 (DVI), 1080p (HDMI), 2048x1536 (VGA).', 'Runs 24/7 at about 19 W and is usually fanless.')
     cannot = @('No Vulkan, ever - AMD Vulkan starts at GCN 1.0.', 'No OpenCL on modern Windows: the last Terascale driver was Catalyst 15.7.1 (2015).', 'Cannot mine: RandomX needs 2.1 GB, Ethash/KawPow need 4.5-5 GB.')
     slot = 'SLOT: video out - leave it in, no monitor changes needed'
     note = 'Terascale 2 predates Vulkan by four years. On tiny11 it runs Microsoft Basic Display.' } ,
  @{ n = 2
     name = 'HD 4670 1G DDR3'
     vram = '1 GB DDR3'; die = 'RV730 - Terascale 1'; year = '2008'
     vulkan = 'NO'; verdict = 'DISPLAY ONLY - spare, worst card in the box'
     sticker = @('PN    288-DE101-440SA', 'SKU   11138-34', 'SN    A094900072632')
     can = @('Drives a monitor. That is the whole list.')
     cannot = @('No Vulkan, no OpenCL on Windows 11 - HD 4000 series ended at Catalyst 13.1 (2013).', 'DX10.1 hardware; nothing modern will run on it.', 'Cannot mine anything profitable.')
     slot = 'SLOT: spare / second monitor if one is ever wanted'
     note = 'Oldest card in the set. Keep it as a video-out fallback, never as compute.' } ,
  @{ n = 3
     name = 'Sapphire HD 6750'
     vram = '1 GB GDDR5'; die = 'Juniper - Terascale 2'; year = '2010'
     vulkan = 'NO'; verdict = 'DISPLAY ONLY - spare'
     sticker = @('PN    288-7E160-A00AC', 'SN    A113200001992', 'D/HDMI/DP')
     can = @('Drives a monitor, and it is faster than cards 1 and 2 at plain 2D.', '1 GB of GDDR5, so a desktop is comfortable.')
     cannot = @('No Vulkan (Terascale 2).', 'No usable OpenCL on tiny11 - legacy driver only.', 'Cannot mine: dataset coins do not fit 1 GB.')
     slot = 'SLOT: spare'
     note = 'Better silicon than the HD 5450 but the same dead end: Terascale has no modern compute path.' } ,
  @{ n = 4
     name = 'Sapphire HD 7770 GHz Edition'
     vram = '1 GB GDDR5'; die = 'Cape Verde XT - GCN 1.0'; year = '2012'
     vulkan = 'YES, with the legacy Adrenalin 21.5.2'; verdict = 'COMPUTE - a few LLM layers, nothing more'
     sticker = @('PN    299-1E244-001SA', 'SKU   11201-17', 'HDMI / DVI / DP')
     can = @('The only AMD card here with a Vulkan driver - it can join the llama.cpp pool.', 'Adds 1 GB of capacity in -sm layer.')
     cannot = @('If 21.5.2 refuses to install on tiny11, drop it from -dev and nothing else breaks.', 'Too small to hold a whole model; it is capacity, not speed.', 'Mining is not worth the watts.')
     slot = 'SLOT: compute - candidate for the Vulkan pool'
     note = 'GCN 1.0 is exactly where AMD''s Vulkan support begins. Verify with llama-server --list-devices.' } ,
  @{ n = 5
     name = 'ASUS Phoenix GT 1030'
     vram = '2 GB GDDR5'; die = 'GP108 - Pascal'; year = '2017'
     vulkan = 'YES'; verdict = 'COMPUTE - small LLM, fully resident'
     sticker = @('PN    PH-GT1030-O2G', 'SN    L9YVYZ019436YGJ', '30 W, no power connector')
     can = @('Runs a 1.5B at Q4 entirely on the card with llama.cpp Vulkan or CUDA.', 'Pascal, so the current NVIDIA driver (580.88) covers it.')
     cannot = @('Autolykos2 wants 2.2-2.4 GB - a 2 GB card fails it, so mining is out.', 'Cannot hold a 7B: 4.4 GB does not fit 2 GB.')
     slot = 'SLOT: compute - Vulkan pool member'
     note = 'Best use: a small always-on assistant model or vision helper, not a miner.' } ,
  @{ n = 6
     name = 'Zotac GTX 1050 Ti 4GB OC'
     vram = '4 GB GDDR5'; die = 'GP107 - Pascal'; year = '2016'
     vulkan = 'YES'; verdict = 'COMPUTE - real LLM member plus light mining'
     sticker = @('PN    288-1N454-200Z8', 'SN    N170900012738', 'SKU   ZT-P10510C-10H')
     can = @('Holds a 3B at Q4 fully, or a 7B in the pool with the other cards.', 'Autolykos2-class mining fits in 4 GB; 75 W, no power connector.')
     cannot = @('Ethash/Etchash DAG is over 5 GB - no.', 'KawPow DAG is over 4.5 GB - no.', 'RandomX fits but runs hot and slow for the yield.')
     slot = 'SLOT: compute - Vulkan pool member, mining candidate'
     note = 'One of only two cards in this box that can both serve an LLM and mine.' } ,
  @{ n = 7
     name = 'GTX 1650 4GB GDDR5'
     vram = '4 GB GDDR5'; die = 'TU117 - Turing'; year = '2019'
     vulkan = 'YES'; verdict = 'BEST CARD IN THE BOX - compute first'
     sticker = @('PN    288-1N348-600A8', 'SN    N20220096420', 'MFG   2020-05-28')
     can = @('Newest and fastest card here: Turing, current drivers, full Vulkan.', 'Holds a 3B fully, and carries the biggest share of a pooled 7B or 13B.', 'Autolykos2-class mining fits in 4 GB; 75 W.')
     cannot = @('Ethash/Etchash and KawPow DAGs do not fit in 4 GB.', 'Still one card: it will not make a 13B fast on its own.')
     slot = 'SLOT: compute - primary Vulkan pool member (highest -ts share)'
     note = 'If only one card gets a job, it is this one.' } ,
  @{ n = 8
     name = 'ReX card A - Radeon R9 200 Series'
     vram = '2 GB'; die = 'GCN 1.0-2.0 (Tahiti / Curacao / Hawaii / Tonga)'; year = '2013-2015'
     vulkan = 'YES if 21.5.2 installs'; verdict = 'PENDING ID - read the PCI device id, then decide'
     sticker = @('MODEL unknown - Windows says only "R9 200 Series"', 'PCI  VEN_1002 + DEV_????', 'Came out of ReX 2026-11-08')
     can = @('GCN does have a Vulkan driver (legacy Adrenalin 21.5.2), so it can join the pool as capacity.', 'Adds 2 GB in -sm layer if the driver installs.')
     cannot = @('Mining: Autolykos2 wants 2.2-2.4 GB, a 2 GB card fails it. Ethash DAG is over 5 GB. No.', 'Layer split is sequential - a slow card adds its time to every token.')
     slot = 'SLOT: compute candidate - one of miner1''s two free slots'
     note = 'DEV 6819 = R9 270/270X . 6810/6811 = 280X/280 . 6798 = 290/290X . 67B0 = R9 370-class. Write it in below.' } ,
  @{ n = 9
     name = 'ReX card B - Radeon R9 200 Series'
     vram = '2 GB'; die = 'GCN 1.0-2.0 (Tahiti / Curacao / Hawaii / Tonga)'; year = '2013-2015'
     vulkan = 'YES if 21.5.2 installs'; verdict = 'PENDING ID - read the PCI device id, then decide'
     sticker = @('MODEL unknown - Windows says only "R9 200 Series"', 'PCI  VEN_1002 + DEV_????', 'Came out of ReX 2026-11-08')
     can = @('Same as card A: Vulkan capacity if the legacy driver installs.', 'Two of them together take the pool from 11 GB to about 15 GB.')
     cannot = @('No mining value at 2 GB.', 'Capacity only - expect tokens per second to fall as the pool grows.')
     slot = 'SLOT: compute candidate - miner1''s second free slot'
     note = 'If both appear in --list-devices, a 13B at Q4 fits. If not, the slots stay empty and nothing is lost.' }
@{ n = 10
     name = 'NVIDIA GT 610 2GD3'
     vram = '2 GB DDR3 (64-bit)'; die = 'GF119 - Fermi 2.1'; year = '2012'
     vulkan = 'NO'; verdict = 'DISPLAY ONLY - Fermi has no Vulkan and no modern CUDA'
     sticker = @('MODEL NVIDIA GT610 - 2GD3', 'TEXT  GT610 2GB 64BIT DDR3 HDMI/DVI/VGA', '49 CUDA cores, ~29 W, passive or small fan')
     can = @('Drives a monitor - HDMI, DVI and VGA on the bracket.', '2 GB, so it is inside miner1''s 4 GB limit if a slot is ever spare.')
     cannot = @('No Vulkan: NVIDIA Vulkan starts at Kepler, and Fermi is two generations older.', 'CUDA 2.1: the last driver is 391.35 (2018), so no modern CUDA either.', 'Mining: a 64-bit DDR3 bus is ~14 GB/s - nothing pays for the slot.')
     slot = 'SLOT: spare display card'
     note = 'Rebadged GT 520. Useful only as a video out on a board that has none.' } ,
  @{ n = 11
     name = 'MSI R7 370 2GD5T OC'
     vram = '2 GB GDDR5'; die = 'Trinidad - GCN 1.0'; year = '2015'
     vulkan = 'YES, with legacy Adrenalin 21.5.2'; verdict = 'COMPUTE - capacity only, 2 GB'
     sticker = @('MODEL R7 370 2GD5T OC', 'SN    602-V305-250B1509001141', '1x 6-pin, ~110 W')
     can = @('GCN 1.0, so it has a Vulkan driver and can join the llama.cpp pool as capacity.', 'Fits inside miner1''s 4 GB limit.')
     cannot = @('Mining: Autolykos2 wants 2.2-2.4 GB and a 2 GB card fails it; Ethash/KawPow DAGs are worse.', 'Layer split is sequential - a slow 2 GB card adds its time to every token.')
     slot = 'SLOT: compute candidate - pool capacity'
     note = 'Same silicon family as the R9 200 cards: GCN 1.0 with a legacy driver, not a miner.' } ,
  @{ n = 12
     name = 'ASUS RX 580 8GB (AXRX 580 8GBD5-3DHDV2/OC)'
     vram = '8 GB GDDR5'; die = 'Polaris 20 - GCN 4'; year = '2017-2020'
     vulkan = 'YES'; verdict = 'TOO BIG FOR miner1 - 8 GB, belongs in a robert-class box'
     sticker = @('MODEL AXRX 580 8GBD5-3DHDV2/OC', 'SN    UG2004001475', 'EAN   4715409189176')
     can = @('Real mining card: Ethash/Etchash DAG (~5.2 GB) and KawPow both fit in 8 GB.', 'Vulkan capable, so it can serve an LLM on the same box it mines on.', 'Excellent llama.cpp member - 8 GB holds a 7B at Q5 outright.')
     cannot = @('NOT for miner1: the board''s limit is 4 GB per card.', 'Needs a full-size PSU with an 8-pin lead, and it is loud under load.')
     slot = 'SLOT: not miner1 - robert / ReX / any 8-pin box'
     note = 'Keep this one out of the 2-core rig: it is the most valuable card in the batch for real work.' } ,
  @{ n = 13
     name = 'XFX RX 580 8GB OC+ (RX-580P8D VB.3)'
     vram = '8 GB GDDR5'; die = 'Polaris 20 - GCN 4'; year = '2018'
     vulkan = 'YES'; verdict = 'TOO BIG FOR miner1 - 8 GB, belongs in a robert-class box'
     sticker = @('MODEL RX-580P8D VB.3', 'TEXT  GTS XXX ED RX 580 8GB OC+ 1386M D5', 'OUT   3xDP / HDMI / DVI - made in China')
     can = @('1386 MHz factory overclock - the fastest card seen in this batch.', 'Ethash/Etchash and KawPow fit in 8 GB; Vulkan for LLM duty as well.', 'Holds a 7B at Q5 in one card, no pooling needed.')
     cannot = @('NOT for miner1: 4 GB per card is the board''s limit.', 'Two 8-pin/6-pin feeds in most builds - check the PSU before it goes in anything.')
     slot = 'SLOT: not miner1 - robert / ReX / any full-size box'
     note = 'Serial on the sticker is T3Y082000? - the photo cut the tail; read it in pen below if it matters.' } ,
  @{ n = 14
     name = 'Radeon HD 6450 (Dell OEM, built by Pegatron)'
     vram = '1 GB DDR3 (verify)'; die = 'Caicos - Terascale 2'; year = '2011'
     vulkan = 'NO'; verdict = 'DISPLAY ONLY - low-profile spare'
     sticker = @('PCB   PEGATRON HD6450 REV:1.00A  18S/26497-01', 'DELL  CN-0HCUMH-74431-22J-02P0-A00', 'BOARD 113-AL000200-101')
     can = @('Half-height, single slot, low power - a video out for a small case.', 'Fits miner1''s 4 GB limit and needs no power lead.')
     cannot = @('No Vulkan (Terascale 2), no OpenCL on modern Windows.', 'Cannot mine: 1 GB and a legacy driver.')
     slot = 'SLOT: spare display card (low profile)'
     note = 'Sticker does not name the model; the Dell part number and the Pegatron silkscreen are what identify it.' }
)

$grandTotal = $cards.Count            # what the page HEADER says: "CARD 2 OF 14" stays true on a single-card reprint
$onlyNums = @()
if ($Only.Trim()) { $onlyNums = @($Only -split '[,;\s]+' | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ }) }
if ($onlyNums.Count -gt 0) { $cards = @($cards | Where-Object { $onlyNums -contains $_.n }) }
if ($cards.Count -eq 0) { throw "no cards matched -Only '$Only'" }
$total = $grandTotal
$pagesToPrint = $cards.Count
$folder = 'C:\AI\reports\cards'
New-Item -ItemType Directory -Force $folder | Out-Null

function Draw-Sheet {
  param($g, $card, $index, $total)

  $pageW = $g.VisibleClipBounds.Width
  $pageH = $g.VisibleClipBounds.Height
  $L = 34; $R = $pageW - 34; $W = $R - $L
  $grey = [System.Drawing.Color]::FromArgb(110, 110, 110)
  $rule = [System.Drawing.Color]::FromArgb(205, 205, 205)
  $F = { param($sz, $style) [System.Drawing.Font]::new('Segoe UI', [single]$sz, $style, [System.Drawing.GraphicsUnit]::Point) }
  $M = { param($sz) [System.Drawing.Font]::new('Consolas', [single]$sz, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Point) }
  $y = 46

  # ---- header: card number
  $g.DrawString(('CARD {0} OF {1}   .   miner1' -f $card.n, $total), (& $F 9 ([System.Drawing.FontStyle]::Bold)), [System.Drawing.Brushes]::DimGray, [single]$L, [single]$y)
  $y += 34

  # ---- name: shrink until it fits in two lines, then wrap inside the margin.
  # A 26pt title ran off the page on "ASUS RX 580 8GB (AXRX 580 8GBD5-3DHDV2/OC)" - a name is data, so the
  # layout bends, not the name.
  $titleFont = & $F 26 ([System.Drawing.FontStyle]::Bold)
  $rectW = [single]$W
  while ($titleFont.Size -gt 14) {
    $meas = $g.MeasureString($card.name, $titleFont, [System.Drawing.SizeF]::new($rectW, [single]10000))
    if ($meas.Height -le ($titleFont.GetHeight($g) * 2.3)) { break }
    $ns = [double]$titleFont.Size - 1
    $titleFont.Dispose()
    $titleFont = & $F $ns ([System.Drawing.FontStyle]::Bold)
  }
  $tRect = [System.Drawing.RectangleF]::new([single]$L, [single]$y, $rectW, [single]160)
  $g.DrawString($card.name, $titleFont, [System.Drawing.Brushes]::Black, $tRect, [System.Drawing.StringFormat]::GenericTypographic)
  $sz = $g.MeasureString($card.name, $titleFont, [System.Drawing.SizeF]::new($rectW, [single]10000))
  $y += [int]$sz.Height + 8

  # ---- verdict bar
  $vf = & $F 14 ([System.Drawing.FontStyle]::Bold)
  while ($vf.Size -gt 9 -and $g.MeasureString($card.verdict, $vf).Width -gt ($W - 26)) {
    $ns = [double]$vf.Size - 0.5
    $vf.Dispose()
    $vf = & $F $ns ([System.Drawing.FontStyle]::Bold)
  }
  $vsz = $g.MeasureString($card.verdict, $vf)
  $barH = [int]$vsz.Height + 18
  $g.FillRectangle([System.Drawing.Brushes]::Black, [single]$L, [single]$y, [single]$W, [single]$barH)
  $g.DrawString($card.verdict, $vf, [System.Drawing.Brushes]::White, [single]($L + 12), [single]($y + 9))
  $y += $barH + 22

  # ---- key/value rows
  $labF = & $F 9.5 ([System.Drawing.FontStyle]::Bold)
  $valF = & $F 12.5 ([System.Drawing.FontStyle]::Regular)
  $rows = @(
    @('VRAM',   $card.vram),
    @('DIE',    $card.die),
    @('YEAR',   $card.year),
    @('VULKAN', $card.vulkan)
  )
  foreach ($kv in $rows) {
    $g.DrawString($kv[0], $labF, [System.Drawing.SolidBrush]::new($grey), [single]$L, [single]($y + 4))
    $g.DrawString($kv[1], $valF, [System.Drawing.Brushes]::Black, [single]($L + 78), [single]$y)
    $y += 27
  }
  $y += 10
  $penRule = [System.Drawing.Pen]::new($rule, [single]1)
  $x1 = [single]$L; $x2 = [single]$R; $yy = [single]$y
  $g.DrawLine($penRule, $x1, $yy, $x2, $yy)
  $y += 16

  # ---- sticker block (monospace, because part numbers must not be mistyped)
  $g.DrawString('STICKER', $labF, [System.Drawing.SolidBrush]::new($grey), [single]$L, [single]$y)
  $y += 18
  $mono = & $M 10.5
  foreach ($s in $card.sticker) {
    $g.DrawString($s, $mono, [System.Drawing.Brushes]::Black, [single]$L, [single]$y)
    $y += 17
  }
  $y += 16

  # ---- what it is for
  $hdr = & $F 10 ([System.Drawing.FontStyle]::Bold)
  $body = & $F 11.5 ([System.Drawing.FontStyle]::Regular)
  $g.DrawString('GOOD FOR', $hdr, [System.Drawing.SolidBrush]::new($grey), [single]$L, [single]$y)
  $y += 19
  foreach ($t in $card.can) {
    $g.DrawString('- ' + $t, $body, [System.Drawing.Brushes]::Black, [single]$L, [single]$y)
    $y += 19
  }
  $y += 10
  $g.DrawString('CANNOT DO', $hdr, [System.Drawing.SolidBrush]::new($grey), [single]$L, [single]$y)
  $y += 19
  foreach ($t in $card.cannot) {
    $g.DrawString('- ' + $t, $body, [System.Drawing.Brushes]::Black, [single]$L, [single]$y)
    $y += 19
  }
  $y += 14

  # ---- slot line
  $slotFont = & $F 12 ([System.Drawing.FontStyle]::Bold)
  $g.FillRectangle([System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(240, 240, 236)), [single]$L, [single]$y, [single]$W, [single]32)
  $g.DrawString($card.slot, $slotFont, [System.Drawing.Brushes]::Black, [single]($L + 10), [single]($y + 7))
  $y += 48

  # ---- the note
  $noteF = & $F 10 ([System.Drawing.FontStyle]::Italic)
  $nr = [System.Drawing.RectangleF]::new([single]$L, [single]$y, [single]$W, [single]48)
  $g.DrawString($card.note, $noteF, [System.Drawing.SolidBrush]::new($grey), $nr)
  $y += 56

  # ---- write-in area: this is the part that makes the page useful at the bench
  $penRule = [System.Drawing.Pen]::new($rule, [single]1)
  $x1 = [single]$L; $x2 = [single]$R; $yy = [single]$y
  $g.DrawLine($penRule, $x1, $yy, $x2, $yy)
  $y += 14
  $g.DrawString('MEASURED ON THE BENCH', $hdr, [System.Drawing.SolidBrush]::new($grey), [single]$L, [single]$y)
  $y += 24
  foreach ($q in @('PCI device id  VEN_1002 / DEV_', 'driver + version', 'llama-server --list-devices  seen?', 'tokens/s if tested', 'hashrate if tested')) {
    $g.DrawString($q, $mono, [System.Drawing.Brushes]::Black, [single]$L, [single]$y)
    $g.DrawLine([System.Drawing.Pen]::new($rule, 1), [single]($L + 300), [single]($y + 15), [single]$R, [single]($y + 15))
    $y += 30
  }

  # ---- footer
  $foot = & $F 8 ([System.Drawing.FontStyle]::Regular)
  $g.DrawString(('miner1 card sheet . printed {0} . identity from the card''s own label' -f (Get-Date -Format 'yyyy-MM-dd HH:mm')), $foot, [System.Drawing.SolidBrush]::new($grey), [single]$L, [single]($pageH - 40))
  $g.DrawString(('{0} / {1}' -f $index, $total), $foot, [System.Drawing.SolidBrush]::new($grey), [single]($R - 40), [single]($pageH - 40))
}

if ($DryRun) {
  foreach ($c in $cards) {
    $bmp = [System.Drawing.Bitmap]::new(850, 1100)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
    $g.Clear([System.Drawing.Color]::White)
    Draw-Sheet -g $g -card $c -index $c.n -total $total
    $out = Join-Path $folder ('page-{0}.png' -f $c.n)
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    'rendered ' + $out
  }
  'DRY RUN - {0} page(s) rendered, nothing printed.' -f $pagesToPrint
  return
}

$doc = [System.Drawing.Printing.PrintDocument]::new()
$doc.PrinterSettings.PrinterName = $Printer
if (-not $doc.PrinterSettings.IsValid) { throw "printer not usable: $Printer" }
$doc.DefaultPageSettings.Landscape = $false
$doc.DefaultPageSettings.Margins = [System.Drawing.Printing.Margins]::new(40, 40, 40, 45)
# a tag goes on ONE side of ONE sheet: the first run duplexed, which put cards 2 and 3 on the two
# faces of the same paper - the opposite of one page per card
try { $doc.DefaultPageSettings.Duplex = [System.Drawing.Printing.Duplex]::Simplex }
catch { 'per-job duplex could not be forced (' + $_.Exception.Message + ') - the queue default governs' }
$paper = $doc.DefaultPageSettings.PaperSize
'printer {0} . paper {1} {2}x{3} . {4} page(s) in this job' -f $Printer, $paper.PaperName, $paper.Width, $paper.Height, $pagesToPrint

$script:idx = 0
$doc.add_PrintPage({
  param($sender, $e)
  $e.Graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  $e.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  Draw-Sheet -g $e.Graphics -card $cards[$script:idx] -index $cards[$script:idx].n -total $total
  $script:idx++
  $e.HasMorePages = ($script:idx -lt $cards.Count)
})

$before = (Get-PrintJob -PrinterName $Printer -ErrorAction SilentlyContinue | Measure-Object).Count
$doc.Print()
Start-Sleep -Seconds 3
$after = Get-PrintJob -PrinterName $Printer -ErrorAction SilentlyContinue
'jobs before: {0}  jobs now: {1}' -f $before, ($after | Measure-Object).Count
if ($after) { $after | Select-Object Id, JobStatus, Size, SubmittedTime | Format-Table -AutoSize | Out-String }
else { 'queue empty after the send = accepted and flushed to the engine' }
