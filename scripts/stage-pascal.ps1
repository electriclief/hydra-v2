# The 582.66 unpack is gone from disk (only the 870 MB installer remains), so re-extract it and put the Pascal/Maxwell
# display INF into the driver store. Then the GTX 1050 Ti binds the moment it is seated, with no download and no wait.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }

Section 'extract 582.66'
$exe = 'C:\AI\tools\dl\nvidia-582.66.exe'
$out = 'C:\AI\tools\nv582'
if (Test-Path $out) { Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force $out | Out-Null
$sw = [Diagnostics.Stopwatch]::StartNew()
& 'C:\AI\tools\7zr.exe' x $exe ("-o" + $out) -y 2>&1 | Select-Object -Last 2
'  {0:N0} s' -f $sw.Elapsed.TotalSeconds

Section 'which INF carries DEV_1C82 (GTX 1050 Ti) and DEV_17C8 (980 Ti)'
$all = @(Get-ChildItem $out -Recurse -Filter '*.inf' -ErrorAction SilentlyContinue)
'  inf files: {0}' -f $all.Count
$targets = @()
foreach ($f in $all) {
  foreach ($id in 'DEV_1C82', 'DEV_17C8') {
    try { if (Select-String -Path $f.FullName -Pattern $id -SimpleMatch -Quiet) { $targets += $f.FullName; '  {0}  in {1}' -f $id, $f.Name; break } } catch { }
  }
}
$targets = @($targets | Select-Object -Unique)
'  display INF candidates: {0}' -f $targets.Count

Section 'add to the driver store (no /install: nothing to bind yet, this only stages it)'
foreach ($t in $targets) {
  if ($t -match '(?i)nv_dispi|nvae') {
    '  adding ' + $t
    & pnputil /add-driver $t 2>&1 | ForEach-Object { '    ' + $_.Trim() }
  }
}

Section 'store now'
$raw = & pnputil /enum-drivers 2>&1
$cur = @{}; $rows = @()
foreach ($line in $raw) {
  if ($line -match '^Published Name:\s*(.+)$') { if ($cur.Count) { $rows += [pscustomobject]$cur }; $cur = @{ oem = $Matches[1].Trim() } }
  elseif ($line -match '^Original Name:\s*(.+)$') { $cur.orig = $Matches[1].Trim() }
  elseif ($line -match '^Provider Name:\s*(.+)$') { $cur.provider = $Matches[1].Trim() }
  elseif ($line -match '^Driver Version:\s*(.+)$') { $cur.version = $Matches[1].Trim() }
}
if ($cur.Count) { $rows += [pscustomobject]$cur }
@($rows | Where-Object { $_.provider -match '(?i)nvidia' }) | Sort-Object version -Descending |
  Format-Table oem, orig, version -AutoSize | Out-String -Width 110
'PASCAL-STAGE DONE'
