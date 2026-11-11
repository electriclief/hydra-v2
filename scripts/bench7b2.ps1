# The 3-card 7B load died with "device lost on Vulkan1" (vk::Queue::submit: ErrorDeviceLost).
# Two attempts, cheapest first: (A) the two 4 GB cards only - the model needs 4.7 GB, so 8 GB is enough and it avoids
# overcommitting the 2 GB GT 1030; (B) all three with an explicit tensor split that keeps the 1030's share small.
$ErrorActionPreference = 'Continue'
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 4
$model = 'C:\AI\models\qwen2.5-7b-q4km.gguf'
$lb = 'C:\AI\llama\llama-bench.exe'

function Run($label, $extra) {
  '=== ' + $label
  $out = "C:\AI\logs\7b-$label.txt"
  Remove-Item $out -Force -ErrorAction SilentlyContinue
  $a = @('-m', $model, '-p', '128', '-n', '32', '-ngl', '99') + $extra
  & $lb @a 2>&1 | Out-File $out -Encoding UTF8
  $l = Get-Content $out
  $bad = $l | Where-Object { $_ -match 'device lost|error loading|failed to load' }
  if ($bad) { '  FAILED: ' + ($bad[0].Trim()) } else {
    $l | Where-Object { $_ -match 'pp128|tg32' } | ForEach-Object { '  ' + $_.Trim() }
    $l | Where-Object { $_ -match 'offloaded' } | Select-Object -First 4 | ForEach-Object { '  ' + $_.Trim() }
  }
}

Run 'two4gb' @('-dev', 'Vulkan1,Vulkan2', '-sm', 'layer')
Start-Sleep -Seconds 5
Run 'all3'   @('-sm', 'layer', '-ts', '0.42,0.42,0.16')

'--- vram after'
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=index,name,memory.used --format=csv,noheader
'BENCH7B2 DONE'
