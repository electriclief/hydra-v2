$ErrorActionPreference = 'Continue'
'bench processes running: ' + (@(Get-Process llama-bench -ErrorAction SilentlyContinue).Count)
foreach ($f in 'pooled3', 'two4gb', 'solo1650', 'solo1030') {
  $p = "C:\AI\logs\3b-$f.txt"
  '--- ' + $f
  if (-not (Test-Path $p)) { '  (no file)'; continue }
  $l = Get-Content $p
  $rows = @($l | Where-Object { $_ -match 'pp128|tg32' })
  if ($rows.Count) { $rows | ForEach-Object { '  ' + $_.Trim() } } else { '  (no result rows)' }
  $bad = @($l | Where-Object { $_ -match 'failed to allocate|device lost|error loading' })
  if ($bad.Count) { '  ' + (($bad | Select-Object -First 1).Trim()) }
}
