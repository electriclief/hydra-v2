# The card sits at CM_PROB_REINSTALL on display.inf. What did setupapi say this boot, and what state is nvlddmkm in?
$ErrorActionPreference = 'Continue'
'=== nvlddmkm and related services'
foreach ($s in 'nvlddmkm', 'NVDisplay.ContainerLocalSystem', 'nvcontainer') {
  $svc = Get-Service $s -ErrorAction SilentlyContinue
  if ($svc) { '  {0,-32} {1,-10} {2}' -f $svc.Name, $svc.Status, $svc.StartType } else { '  {0,-32} absent' -f $s }
}
$p = Get-CimInstance Win32_Service -Filter "Name='nvlddmkm'" -ErrorAction SilentlyContinue
if ($p) { '  path: ' + $p.PathName }

'=== setupapi sections mentioning dev_1c82 (this boot)'
$log = 'C:\Windows\INF\setupapi.dev.log'
if (Test-Path $log) {
  $lines = Get-Content $log
  # find the last section that names the card and print it whole
  $idx = @()
  for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match 'dev_1c82') { $idx += $i } }
  '{0} mentions in {1} lines' -f $idx.Count, $lines.Count
  if ($idx.Count) {
    $last = $idx[-1]
    # walk back to the section start
    $s = $last
    while ($s -gt 0 -and ($lines[$s] -notmatch '^>>>')) { $s-- }
    $e = $last
    while ($e -lt $lines.Count - 1 -and ($lines[$e] -notmatch '<<<.*Section end')) { $e++ }
    '  section lines {0}..{1}' -f $s, $e
    $lines[$s..([Math]::Min($e, $s + 70))] | ForEach-Object { '  ' + $_ }
  }
} else { '  no log' }
'WHY1050B DONE'
