# Fourth device is the R9 270X on AMD's Vulkan runtime. Two questions: does llama.cpp pool four devices across two vendors,
# and does the extra 1.7 GB free finally let the 7B load?
$ErrorActionPreference = 'Continue'
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 4
$lb = 'C:\AI\llama\llama-bench.exe'

'=== device order right now'
& $lb --list-devices 2>&1 | Where-Object { $_ -match 'Vulkan\d' } | ForEach-Object { '  ' + ($_ -replace "`0", '') }

function Run($label, $model, $extra) {
  '=== ' + $label
  $out = "C:\AI\logs\4dev-$label.txt"
  Remove-Item $out -Force -ErrorAction SilentlyContinue
  $a = @('-m', $model, '-p', '128', '-n', '32', '-ngl', '99') + $extra
  & $lb @a 2>&1 | Out-File $out -Encoding UTF8
  $l = Get-Content $out
  $bad = @($l | Where-Object { $_ -match 'failed to allocate|device lost|error loading|failed to load' })
  if ($bad.Count) { '  FAILED: ' + (($bad | Select-Object -First 1).Trim()) }
  $rows = @($l | Where-Object { $_ -match 'pp128|tg32' })
  if ($rows.Count) { $rows | ForEach-Object { '  ' + $_.Trim() } }
  $l | Where-Object { $_ -match 'offloaded' } | Select-Object -First 2 | ForEach-Object { '  ' + $_.Trim() }
}

Run '3b-4dev' 'C:\AI\models\qwen2.5-3b-q4km.gguf' @('-sm', 'layer')
Start-Sleep -Seconds 5
Run '7b-4dev' 'C:\AI\models\qwen2.5-7b-q4km.gguf' @('-sm', 'layer')

'--- vram after'
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=index,name,memory.used --format=csv,noheader
'4DEV DONE'
