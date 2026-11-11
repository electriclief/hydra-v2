# Read the two-card report as UTF-16 and re-emit it as ASCII so it survives ssh and paste.
$src = 'C:\AI\reports\miner1-twocard.txt'
$dst = 'C:\AI\reports\twocard-ascii.txt'
$bytes = [System.IO.File]::ReadAllBytes($src)
$t = $null
foreach ($enc in @([System.Text.Encoding]::Unicode, [System.Text.Encoding]::BigEndianUnicode, [System.Text.Encoding]::UTF8)) {
  $try = $enc.GetString($bytes)
  if ($try -match 'total') { $t = $try; break }
}
if (-not $t) { $t = [System.Text.Encoding]::Unicode.GetString($bytes) }
$t = $t -replace "`0", ''
[System.IO.File]::WriteAllText($dst, $t, [System.Text.Encoding]::ASCII)
Get-Content $dst | Select-Object -Last 14
