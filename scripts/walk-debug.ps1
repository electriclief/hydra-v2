# Why did the walk count 39 files on a volume with 168 GB used?
$ErrorActionPreference = 'Continue'

$vol = 'F:\'
$targets = @($vol, (Join-Path $vol 'Users'), (Join-Path $vol 'Windows'))

foreach ($t in $targets) {
  if (-not (Test-Path -LiteralPath $t)) { 'missing: ' + $t; continue }
  '== ' + $t

  # 1. plain .NET walk, exactly what disk-facts does
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $files = 0; $bytes = [int64]0; $errs = 0; $firstErr = ''
  $stack = New-Object System.Collections.Stack
  $stack.Push((Get-Item -LiteralPath $t -Force))
  while ($stack.Count -gt 0 -and $sw.Elapsed.TotalSeconds -lt 20) {
    $dir = $stack.Pop()
    try {
      foreach ($child in [System.IO.Directory]::EnumerateFileSystemEntries($dir.FullName)) {
        try {
          $fi = New-Object System.IO.FileInfo $child
          if ($fi.Attributes -band [System.IO.FileAttributes]::Directory) { $stack.Push($fi) } else { $files++; $bytes += $fi.Length }
        } catch { $errs++; if (-not $firstErr) { $firstErr = $_.Exception.GetType().Name + ': ' + $_.Exception.Message } }
      }
    } catch { $errs++; if (-not $firstErr) { $firstErr = $_.Exception.GetType().Name + ': ' + $_.Exception.Message } }
  }
  '  plain .NET  files={0} bytes={1:N0} errs={2} first={3}' -f $files, $bytes, $errs, $firstErr

  # 2. the same walk with the \\?\ long-path prefix (what Windows itself uses internally)
  $sw2 = [System.Diagnostics.Stopwatch]::StartNew()
  $files2 = 0; $bytes2 = [int64]0; $errs2 = 0; $firstErr2 = ''
  $longRoot = '\\?\' + $t
  $stack2 = New-Object System.Collections.Stack
  $stack2.Push($longRoot)
  while ($stack2.Count -gt 0 -and $sw2.Elapsed.TotalSeconds -lt 20) {
    $dirPath = $stack2.Pop()
    try {
      foreach ($child in [System.IO.Directory]::EnumerateFileSystemEntries($dirPath)) {
        try {
          $fi = New-Object System.IO.FileInfo $child
          if ($fi.Attributes -band [System.IO.FileAttributes]::Directory) { $stack2.Push($child) } else { $files2++; $bytes2 += $fi.Length }
        } catch { $errs2++; if (-not $firstErr2) { $firstErr2 = $_.Exception.GetType().Name + ': ' + $_.Exception.Message } }
      }
    } catch { $errs2++; if (-not $firstErr2) { $firstErr2 = $_.Exception.GetType().Name + ': ' + $_.Exception.Message } }
  }
  '  long-path   files={0} bytes={1:N0} errs={2} first={3}' -f $files2, $bytes2, $errs2, $firstErr2
  ''
}

'== robocopy listing (native, long-path safe)'
$out = & robocopy $vol NULL /L /S /NDL /NFL /NJH /BYTES /XJ /XD 'System Volume Information' '$RECYCLE.BIN' 2>&1
$fileLine = ($out | Where-Object { $_ -match '^\s*Files\s*:' } | Select-Object -First 1)
$byteLine = ($out | Where-Object { $_ -match '^\s*Bytes\s*:' } | Select-Object -First 1)
'  files line: ' + ($fileLine -replace '\s+', ' ')
'  bytes line: ' + ($byteLine -replace '\s+', ' ')
