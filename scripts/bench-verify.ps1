# Re-measure per card with labels taken from the device list in the same session - not from nvidia-smi indices.
# Vulkan enumeration order changed across a reboot, so any bench that hardcodes "Vulkan0 = 1650" can be wrong.
$ErrorActionPreference = 'Continue'
Get-Process SRBMiner-MULTI, llama-bench -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 5

$list = & 'C:\AI\llama\llama-bench.exe' --list-devices 2>&1
'=== devices as llama.cpp sees them right now'
$map = @{}
foreach ($line in $list) {
  $l = ($line -replace "`0", '').Trim()
  if ($l -match '^(Vulkan\d+):\s+(.+?)\s+\((\d+)\s+MiB') {
    $map[$matches[1]] = $matches[2] + ' [' + $matches[3] + ' MiB]'
    '  {0,-9} {1}' -f $matches[1], $map[$matches[1]]
  }
}
if (-not $map.Count) { '  could not parse device list:'; $list | ForEach-Object { '  ' + $_ } }

'=== per card, one clean run each'
foreach ($idx in $map.Keys | Sort-Object) {
  $out = "C:\AI\logs\verify-$idx.txt"
  Remove-Item $out -Force -ErrorAction SilentlyContinue
  & 'C:\AI\llama\llama-bench.exe' -m 'C:\AI\models\qwen2.5-0.5b-q4km.gguf' -p 256 -n 64 -ngl 99 -dev $idx -r 1 2>&1 |
    Out-File -FilePath $out -Encoding UTF8
  $row = Get-Content $out | Where-Object { $_ -match 'pp256|tg64' }
  $nums = @()
  foreach ($r in $row) { $c = ($r -split '\|') | ForEach-Object { $_.Trim() }; $nums += $c[$c.Count - 2] }
  '  {0,-28} pp256 {1}   tg64 {2}' -f $map[$idx], $nums[0], $nums[1]
}

'=== both pooled, split mode layer'
$out = 'C:\AI\logs\verify-pooled.txt'
Remove-Item $out -Force -ErrorAction SilentlyContinue
& 'C:\AI\llama\llama-bench.exe' -m 'C:\AI\models\qwen2.5-0.5b-q4km.gguf' -p 256 -n 64 -ngl 99 -sm layer -r 1 2>&1 |
  Out-File -FilePath $out -Encoding UTF8
$row = Get-Content $out | Where-Object { $_ -match 'pp256|tg64' }
$nums = @()
foreach ($r in $row) { $c = ($r -split '\|') | ForEach-Object { $_.Trim() }; $nums += $c[$c.Count - 2] }
'  {0,-28} pp256 {1}   tg64 {2}' -f 'both cards', $nums[0], $nums[1]
'VERIFY DONE'
