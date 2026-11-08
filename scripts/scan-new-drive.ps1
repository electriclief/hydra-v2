# =====================================================================================
#  SCAN-NEW-DRIVE - what is on the drive that was just plugged in, read-only.
#
#  The job the operator asked for: find the old drive's Desktop\Share and anything that looks like output worth backing
#  up one day. Nothing is copied, nothing is written to the drive, nothing is repaired. A drive that "gave issues" is a
#  drive to image, not a drive to let Windows fix - so this script never writes to it and never runs chkdsk.
#
#  Quick, not exhaustive: depth-limited, time-budgeted, and it reports what it could NOT read rather than failing quietly.
#
#    powershell -ExecutionPolicy Bypass -File scripts\scan-new-drive.ps1
#    powershell ... -Drive D: -Depth 5 -BudgetSec 180
# =====================================================================================
param(
  [string]$Drive = '',
  [int]$Depth = 4,
  [int]$BudgetSec = 90,
  [string]$ReportDir = 'C:\AI\reports'
)

$ErrorActionPreference = 'SilentlyContinue'
New-Item -ItemType Directory -Force $ReportDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$report = Join-Path $ReportDir "drive-scan-$stamp.md"
$lines = New-Object System.Collections.Generic.List[string]
function W($s) { $lines.Add($s) | Out-Null; Write-Output $s }

W "# Drive scan $stamp"
W ''
W "depth $Depth · budget ${BudgetSec}s per volume · read-only (nothing copied, nothing written, no chkdsk)"
W ''

# ---- which volumes? everything that is not the system disk
$vols = Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 3 -and $_.DeviceID -ne 'C:' }
if ($Drive) { $vols = $vols | Where-Object { $_.DeviceID -eq $Drive } }
if (-not $vols) {
  W 'No non-system volume is mounted. If the drive is plugged in and not visible, it may be raw, unlettered, or offline.'
  W ''
  W 'What Windows can see:'
  W '```'
  Get-Disk | Select-Object Number, FriendlyName, @{n = 'SizeGB'; e = { [math]::Round($_.Size / 1GB, 1) } }, OperationalStatus, PartitionStyle | Format-Table -AutoSize | Out-String -Width 200 | ForEach-Object { W $_ }
  W '```'
  $lines -join "`n" | Set-Content $report -Encoding UTF8
  W "report: $report"
  return
}

$mediaExt = @('.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff', '.gif', '.mp4', '.mov', '.mkv', '.avi', '.webm',
  '.wav', '.mp3', '.flac', '.ogg', '.safetensors', '.ckpt', '.pt', '.pth', '.bin', '.gguf', '.onnx', '.psd', '.blend',
  '.fbx', '.obj', '.glb', '.zip', '.7z', '.rar', '.iso', '.truenas')
$interesting = @('Share', 'share', 'Desktop\Share', 'output', 'outputs', 'Output', 'Outputs', 'ComfyUI', 'renders',
  'Renders', 'exports', 'Exports', 'projects', 'Projects', 'backups', 'Backups')

foreach ($v in $vols) {
  $root = $v.DeviceID + '\'
  $used = [int](($v.Size - $v.FreeSpace) / 1GB)
  W "## $root  label '$($v.VolumeName)'  $([math]::Round($v.Size / 1GB, 1)) GB total, $used GB used, fs $($v.FileSystem)"
  W ''

  # ---- 1. the folders that matter, by name, near the top
  W '### folders worth looking at (depth-limited, by name)'
  $found = New-Object System.Collections.Generic.List[string]
  $stack = New-Object System.Collections.Generic.Stack[object]
  $stack.Push(@($root, 0))
  $deadline = (Get-Date).AddSeconds($BudgetSec)
  $denied = 0
  while ($stack.Count -gt 0 -and (Get-Date) -lt $deadline) {
    $item = $stack.Pop()
    $dir = $item[0]; $d = $item[1]
    if ($d -ge $Depth) { continue }
    $children = $null
    try { $children = [System.IO.Directory]::GetDirectories($dir) } catch { $denied++; continue }
    foreach ($c in $children) {
      $leaf = Split-Path $c -Leaf
      $isHit = $false
      foreach ($n in $interesting) { if ($leaf -eq $n -or $leaf -like "*$n*") { $isHit = $true; break } }
      # Desktop\Share is the one the operator named: catch it whatever the user folder is called
      if (-not $isHit -and $c -match '(?i)\\Desktop\\Share$') { $isHit = $true }
      if ($isHit) {
        $sz = 0; $n2 = 0
        try {
          $files = [System.IO.Directory]::EnumerateFiles($c, '*', [System.IO.SearchOption]::AllDirectories)
          foreach ($f in $files) { $sz += (New-Object System.IO.FileInfo $f).Length; $n2++; if ((Get-Date) -gt $deadline) { break } }
        } catch { }
        $found.Add(('{0,-12} {1,10:N1} GB  {2,7} files  {3}' -f '', ($sz / 1GB), $n2, $c))
      }
      $stack.Push(@($c, ($d + 1)))
    }
  }
  if ($found.Count -eq 0) { W '  none found by name at this depth' } else { $found | ForEach-Object { W "  $_" } }
  if ($denied -gt 0) { W "  ($denied folders could not be opened - permissions, or a failing disk)" }
  W ''

  # ---- 2. what kind of output is there, by extension, across the whole volume (names only, no content)
  W '### output-shaped files on this volume'
  $byExt = @{}
  $total = 0
  $deadline = (Get-Date).AddSeconds($BudgetSec)
  try {
    $files = [System.IO.Directory]::EnumerateFiles($root, '*', [System.IO.SearchOption]::AllDirectories)
    foreach ($f in $files) {
      if ((Get-Date) -gt $deadline) { W '  (budget reached - this is a partial count, not the whole disk)'; break }
      $ext = [System.IO.Path]::GetExtension($f).ToLowerInvariant()
      if ($mediaExt -notcontains $ext) { continue }
      $len = 0
      try { $len = (New-Object System.IO.FileInfo $f).Length } catch { }
      if (-not $byExt.ContainsKey($ext)) { $byExt[$ext] = @(0, 0) }
      $byExt[$ext] = @(($byExt[$ext][0] + 1), ($byExt[$ext][1] + $len))
      $total += $len
    }
  } catch { W '  (the walk stopped early - a failing disk does that; the counts above are what it managed)' }
  W ''
  W '| ext | files | GB |'
  W '|---|---|---|'
  foreach ($k in ($byExt.Keys | Sort-Object { -$byExt[$_][1] })) {
    W ('| {0} | {1} | {2:N2} |' -f $k, $byExt[$k][0], ($byExt[$k][1] / 1GB))
  }
  W ''
  W ("total output-shaped: {0:N1} GB" -f ($total / 1GB))
  W ''

  # ---- 3. the biggest files: what a backup would actually spend its time on
  W '### the fifteen largest files'
  $top = New-Object System.Collections.Generic.List[object]
  $deadline = (Get-Date).AddSeconds($BudgetSec)
  try {
    $files = [System.IO.Directory]::EnumerateFiles($root, '*', [System.IO.SearchOption]::AllDirectories)
    foreach ($f in $files) {
      if ((Get-Date) -gt $deadline) { break }
      try {
        $fi = New-Object System.IO.FileInfo $f
        $top.Add([pscustomobject]@{ GB = [math]::Round($fi.Length / 1GB, 2); F = $f; When = $fi.LastWriteTime })
      } catch { }
    }
  } catch { }
  $top | Sort-Object -Property GB -Descending | Select-Object -First 15 | ForEach-Object {
    W ('  {0,7:N2} GB  {1}  {2}' -f $_.GB, $_.When.ToString('yyyy-MM-dd'), $_.F)
  }
  W ''
}

$lines -join "`n" | Set-Content $report -Encoding UTF8
Write-Output "report: $report"
