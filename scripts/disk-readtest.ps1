# Read-only speed/behaviour test on a physical disk: is this thing actually alive?
# Reads 16 MB at three offsets straight off the device - no filesystem needed, works on unformatted drives.
param([int]$Drive = 2, [int]$MB = 16)

$path = "\\.\PhysicalDrive$Drive"
$out = @()

# total size from the device, without mounting anything
$size = 0
try {
  $q = & 'C:\Program Files\smartmontools\bin\smartctl.exe' -i -d auto "/dev/sd$([char](97 + $Drive))" 2>$null
  $capLine = ($q | Where-Object { $_ -match '^User Capacity' } | Select-Object -First 1)
  if ($capLine -match '([\d,]{6,})') { $size = [int64](($matches[1]) -replace ',', '') }
} catch { }

$chunk = 1MB
$bytes = $MB * 1MB

foreach ($frac in 0.0, 0.33, 0.66) {
  $offset = if ($size -gt 0) { [int64](($size - $bytes) * $frac / 1MB) * 1MB } else { [int64]($frac * 1024MB) }
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $read = 0
  $err = ''
  try {
    $fs = [System.IO.File]::Open($path, 'Open', 'Read', 'ReadWrite')
    $fs.Position = $offset
    $buf = New-Object byte[] $chunk
    while ($read -lt $bytes) {
      $n = $fs.Read($buf, 0, $chunk)
      if ($n -le 0) { break }
      $read += $n
    }
    $fs.Dispose()
  } catch {
    $err = $_.Exception.GetType().Name + ': ' + $_.Exception.Message
  }
  $sw.Stop()
  $mbs = if ($sw.Elapsed.TotalSeconds -gt 0) { [math]::Round(($read / 1MB) / $sw.Elapsed.TotalSeconds, 1) } else { 0 }
  $out += [pscustomobject]@{
    at = ('{0:P0}' -f $frac); offset_gb = [math]::Round($offset / 1GB, 2)
    read_mb = [math]::Round($read / 1MB, 1); seconds = [math]::Round($sw.Elapsed.TotalSeconds, 2)
    mb_per_s = $mbs; error = $err
  }
}

'device      : ' + $path
'size from smartctl: ' + $(if ($size -gt 0) { '{0:N0} bytes' -f $size } else { 'unknown' })
$out | Format-Table -AutoSize | Out-String
$fails = @($out | Where-Object { $_.error -ne '' }).Count
'slowest read: {0} MB/s   errors: {1}' -f (($out | Measure-Object mb_per_s -Minimum).Minimum), $fails
