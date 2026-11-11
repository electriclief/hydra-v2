# The test this rig was built for: a 7B model that does not fit on any single card, spread across three.
# Records the layer split per device and the pp/tg numbers.
$ErrorActionPreference = 'Continue'
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 4
$model = 'C:\AI\models\qwen2.5-7b-q4km.gguf'
$out = 'C:\AI\logs\bench-7b-pooled.txt'
Remove-Item $out -Force -ErrorAction SilentlyContinue
'file: {0:N0} bytes' -f (Get-Item $model).Length
& 'C:\AI\llama\llama-bench.exe' -m $model -p 256 -n 64 -ngl 99 -sm layer -r 1 2>&1 | Out-File $out -Encoding UTF8
'--- layer assignment (count per device)'
$lines = Get-Content $out
$assign = $lines | Where-Object { $_ -match 'assigned to device' }
$assign | Group-Object { ($_ -split 'assigned to device')[1].Trim() } | ForEach-Object { '  {0,-10} {1,3} layers' -f $_.Name, $_.Count }
'--- offload summary'
$lines | Where-Object { $_ -match 'offloaded|repeating layers|CPU_Mapped|buffer size' } | Select-Object -First 12 | ForEach-Object { '  ' + $_.Trim() }
'--- result'
$lines | Where-Object { $_ -match 'pp256|tg64' } | ForEach-Object { '  ' + $_.Trim() }
'--- vram in use per card'
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=index,name,memory.used,memory.total --format=csv,noheader
'BENCH7B DONE'
