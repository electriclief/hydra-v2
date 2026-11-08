# =====================================================================================
#  print-sheet.ps1 - print a fixed-width ASCII page to the LAN Brother, one page, exact layout.
#
#  Why not Out-Printer: the driver picks its own proportional font and every column in the sheet
#  drifts. This draws the page itself with a monospace font, sized so the longest line fits the
#  paper width and the tallest page fits the height - so what was composed is what is printed.
#
#  Usage: powershell -NoProfile -File print-sheet.ps1 -Path <txt> [-Printer "name"] [-DryRun]
# =====================================================================================
param(
  [Parameter(Mandatory=$true)][string]$Path,
  [string]$Printer = 'Brother DCP-L2550DW',
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $Path)) { throw "no such file: $Path" }
$lines = [System.IO.File]::ReadAllLines($Path)
if ($lines.Count -eq 0) { throw "empty file: $Path" }
$maxChars = ($lines | Measure-Object -Property Length -Maximum).Maximum
if ($maxChars -le 0) { $maxChars = 1 }

$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = $Printer
if (-not $doc.PrinterSettings.IsValid) { throw "printer not usable: $Printer" }

$doc.DefaultPageSettings.Landscape = $false
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins 40, 40, 40, 45
# Letter unless the driver already says otherwise, and say which one we used
$paper = $doc.DefaultPageSettings.PaperSize
"paper: {0} {1}x{2} (hundredths of an inch)" -f $paper.PaperName, $paper.Width, $paper.Height | Write-Host

$bounds = $doc.DefaultPageSettings.PrintableArea
$usableW = $bounds.Width  - $doc.DefaultPageSettings.Margins.Left - $doc.DefaultPageSettings.Margins.Right
$usableH = $bounds.Height - $doc.DefaultPageSettings.Margins.Top  - $doc.DefaultPageSettings.Margins.Bottom

# Courier New: one character is 0.6 em wide; a line is ~1.17 em tall. Take whichever limit is tighter.
$byWidth  = $usableW / ($maxChars * 0.60)
$byHeight = ($usableH / $lines.Count) / 1.17
$size = [math]::Floor([math]::Min($byWidth, $byHeight) * 0.97 * 2) / 2   # half-point steps
if ($size -lt 4) { $size = 4 }
if ($size -gt 11) { $size = 11 }
$lineH = [math]::Ceiling($size * 1.17 * 100) / 100

"lines: {0}  widest: {1} chars  size: {2}pt  line height: {3}  usable: {4}x{5}" -f `
  $lines.Count, $maxChars, $size, $lineH, $usableW, $usableH | Write-Host

if ($DryRun) {
  "DRY RUN - nothing sent. It would print {0} page(s) at {1}pt." -f [math]::Ceiling(($lines.Count * $lineH) / $usableH), $size | Write-Host
  return
}

$font = [System.Drawing.Font]::new('Courier New', [single]$size, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Point)
$script:index = 0

$doc.add_PrintPage({
  param($sender, $e)
  $e.Graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::SingleBitPerPixelGridFit
  $y = $e.MarginBounds.Top
  while ($script:index -lt $lines.Count -and ($y + $lineH) -le $e.MarginBounds.Bottom) {
    $e.Graphics.DrawString($lines[$script:index], $font, [System.Drawing.Brushes]::Black,
                           [single]$e.MarginBounds.Left, [single]$y)
    $y += $lineH
    $script:index++
  }
  $e.HasMorePages = ($script:index -lt $lines.Count)
})

$before = (Get-PrintJob -PrinterName $Printer -ErrorAction SilentlyContinue | Measure-Object).Count
$doc.Print()
Start-Sleep -Seconds 2
$after = Get-PrintJob -PrinterName $Printer -ErrorAction SilentlyContinue
"jobs before: {0}  jobs now: {1}" -f $before, ($after | Measure-Object).Count | Write-Host
if ($after) { $after | Select-Object Id, JobStatus, Size, SubmittedTime | Format-Table -AutoSize | Out-String | Write-Host }
else { "queue empty after the send = accepted and flushed to the engine" | Write-Host }
