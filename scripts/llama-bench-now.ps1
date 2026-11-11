# Clean pp/tg on the CURRENT driver (591.86) with nothing else using the GPU, parsed from llama-bench's own table.
# bench-card's parser returned nulls, so this prints the two numbers in a form that cannot be misread.
$ErrorActionPreference = 'Continue'
Get-Process SRBMiner-MULTI, llama-bench, llama-cli -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
$lb = 'C:\AI\llama\llama-bench.exe'
$model = 'C:\AI\models\qwen2.5-0.5b-q4km.gguf'
$out = 'C:\AI\logs\llama-bench-591.txt'
Remove-Item $out -Force -ErrorAction SilentlyContinue
& $lb -m $model -p 256 -n 64 -ngl 99 -r 1 2>&1 | Tee-Object -FilePath $out | Out-Null
'--- table'
Get-Content $out | Where-Object { $_ -match '^\|' } | ForEach-Object { '  ' + $_ }
'--- parsed'
foreach ($line in (Get-Content $out | Where-Object { $_ -match 'pp256|tg64' })) {
  $f = ($line -split '\|') | ForEach-Object { $_.Trim() }
  # | model | size | params | backend | ngl | test | t/s |
  if ($f.Count -ge 8) { '  {0,-6} {1} t/s' -f $f[6], $f[7] }
}
