# Find the real ceiling: does a 3B Q4 (1.93 GB) load and run across the pool, and what does each card do with it?
$ErrorActionPreference = 'Continue'
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 4
$model = 'C:\AI\models\qwen2.5-3b-q4km.gguf'
$lb = 'C:\AI\llama\llama-bench.exe'
'file: {0:N0} bytes' -f (Get-Item $model).Length

function Run($label, $extra) {
  '=== ' + $label
  $out = "C:\AI\logs\3b-$label.txt"
  Remove-Item $out -Force -ErrorAction SilentlyContinue
  $a = @('-m', $model, '-p', '128', '-n', '32', '-ngl', '99') + $extra
  & $lb @a 2>&1 | Out-File $out -Encoding UTF8
  $l = Get-Content $out
  $bad = $l | Where-Object { $_ -match 'device lost|error loading|failed to load|failed to allocate' }
  if ($bad) { '  FAILED: ' + (($bad | Select-Object -First 1).Trim()) }
  $l | Where-Object { $_ -match 'pp128|tg32' } | ForEach-Object { '  ' + $_.Trim() }
  $l | Where-Object { $_ -match 'offloaded' } | Select-Object -First 2 | ForEach-Object { '  ' + $_.Trim() }
}

Run 'pooled3'  @('-sm', 'layer')
Start-Sleep -Seconds 4
Run 'two4gb'   @('-dev', 'Vulkan1,Vulkan2', '-sm', 'layer')
Start-Sleep -Seconds 4
Run 'solo1650' @('-dev', 'Vulkan1')
Start-Sleep -Seconds 4
Run 'solo1030' @('-dev', 'Vulkan0')

'--- vram after'
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=index,name,memory.used --format=csv,noheader
'BENCH3B DONE'
