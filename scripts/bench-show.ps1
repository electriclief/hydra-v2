# Print the three llama-bench results and the mining tail, whatever state they finished in.
$ErrorActionPreference = 'Continue'
foreach ($pair in @(@('1650', 'C:\AI\logs\bench-1650.txt'), @('1050Ti', 'C:\AI\logs\bench-1050Ti.txt'), @('pooled', 'C:\AI\logs\bench-pooled.txt'))) {
  $label = $pair[0]; $f = $pair[1]
  '--- ' + $label
  if (Test-Path $f) {
    $rows = @(Get-Content $f | Where-Object { $_ -match 'pp256|tg64' })
    if ($rows.Count) {
      foreach ($line in $rows) {
        $cols = ($line -split '\|') | ForEach-Object { $_.Trim() }
        if ($cols.Count -ge 8) { '  {0,-8} {1,10} t/s' -f $cols[6], $cols[7] }
      }
    } else { '  (no result rows)' ; (Get-Content $f -Tail 3) | ForEach-Object { '  ' + $_ } }
  } else { '  missing file' }
}
'--- mining'
$m = 'C:\AI\logs\twogpu-mine.txt'
if (Test-Path $m) {
  Get-Content $m | Where-Object { $_ -match 'GPU\d|Total:|accepted' } | Select-Object -Last 6 | ForEach-Object { '  ' + $_ }
} else { '  no mining log' }
'--- probe still alive'
Get-Process SRBMiner-MULTI, llama-bench -ErrorAction SilentlyContinue | ForEach-Object { '  ' + $_.ProcessName + ' pid ' + $_.Id }
'BENCH-SHOW DONE'
