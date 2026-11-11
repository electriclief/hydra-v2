# Why does PnP refuse the NVIDIA INF for the 1050 Ti? Two pieces of evidence: the INF's own model lines for DEV_1C82
# (including this card's SUBSYS 245419DA), and what setupapi actually decided last time.
$ErrorActionPreference = 'Continue'
$inf = 'C:\AI\tools\nv580\Display.Driver\nv_dispi.inf'
'=== model lines mentioning 1C82 (first 10)'
(Select-String -Path $inf -Pattern '1C82' | Select-Object -First 10) | ForEach-Object { '  ' + $_.Line.Trim() }
'=== lines mentioning this card subsystem 2454.19DA'
$sub = @(Select-String -Path $inf -Pattern '2454' | Select-Object -First 5)
if ($sub.Count) { $sub | ForEach-Object { '  ' + $_.Line.Trim() } } else { '  none - the card would have to match on the generic entry' }

'=== setupapi: last decisions about DEV_1C82'
$log = 'C:\Windows\INF\setupapi.dev.log'
if (Test-Path $log) {
  $lines = Get-Content $log -Tail 4000
  $hits = @()
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '1C82') { $hits += $i }
  }
  '  {0} mentions in the tail' -f $hits.Count
  $start = if ($hits.Count) { [Math]::Max(0, $hits[-1] - 10) } else { 0 }
  $lines[$start..([Math]::Min($lines.Count - 1, $start + 40))] | ForEach-Object { '  ' + $_ }
} else { '  no setupapi.dev.log' }
