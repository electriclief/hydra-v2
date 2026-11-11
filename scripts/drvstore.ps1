# What NVIDIA driver packages are actually IN the driver store, and which one is the card using.
# pnputil output is grouped per package; this flattens it so the oem index, the INF name and the version line up.
$ErrorActionPreference = 'Continue'
$raw = & pnputil /enum-drivers 2>&1
$cur = @{}
$rows = @()
foreach ($line in $raw) {
  if ($line -match '^Published Name:\s*(.+)$') { if ($cur.Count) { $rows += [pscustomobject]$cur }; $cur = @{ oem = $Matches[1].Trim() } }
  elseif ($line -match '^Original Name:\s*(.+)$') { $cur.orig = $Matches[1].Trim() }
  elseif ($line -match '^Provider Name:\s*(.+)$') { $cur.provider = $Matches[1].Trim() }
  elseif ($line -match '^Driver Version:\s*(.+)$') { $cur.version = $Matches[1].Trim() }
}
if ($cur.Count) { $rows += [pscustomobject]$cur }
$nv = @($rows | Where-Object { $_.provider -match '(?i)nvidia' })
'NVIDIA packages in store: {0}' -f $nv.Count
$nv | Sort-Object version -Descending | Format-Table oem, orig, version -AutoSize | Out-String -Width 120 | Write-Host

'=== device -> driver'
& pnputil /enum-devices /class Display /drivers 2>&1 | Where-Object { $_.Trim() } | Select-Object -First 40 | ForEach-Object { '  ' + $_.Trim() }
