# Rewrite the per-card ledger so it holds two honest rows: the 472.80 baseline (with its raw_tail evidence) and the
# 591.86 row measured with nothing else on the GPU. The row bench-card wrote at 15:18 with empty fields is dropped -
# it recorded a moment, not a measurement.
$ErrorActionPreference = 'Stop'
$f = 'C:\AI\reports\miner1-cards.jsonl'
$rows = @()
if (Test-Path $f) {
  foreach ($line in Get-Content $f) {
    if (-not $line.Trim()) { continue }
    try { $o = $line | ConvertFrom-Json } catch { continue }
    $h = $o.miner.hash
    if ($null -ne $h -and "$h" -ne '') { $rows += $o }
  }
}
'SKILL-ROWKEEP: kept {0} existing row(s)' -f $rows.Count

$row = [ordered]@{
  when   = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss')
  host   = 'DESKTOP-GS1R3PU'
  gpus   = @(@{ index = '0'; name = 'NVIDIA GeForce GTX 1650'; bus = '00000000:01:00.0'; vram_mb = '4096'; driver = '591.86'; arch = 'TU117 Turing CC 7.5' })
  links  = @(
    @{ name = 'Intel(R) HD Graphics'; status = 'OK'; width = $null; speed = $null },
    @{ name = 'NVIDIA GeForce GTX 1650'; status = 'OK'; width = 1; speed = 2; max_width = 16; max_speed = 3 }
  )
  llama  = [ordered]@{ model = 'qwen2.5-0.5b-q4km.gguf'; backend = 'Vulkan'; ngl = 99; pp256 = 2738.06; tg64 = 98.10; vr_used_free = '4149 MiB / 3558 MiB free' }
  miner  = [ordered]@{ algo = 'xelishashv3'; seconds = 300; hash = 1704.94; accepted = 2; rejected = 0; hw_errors = 0; pool = 'xelishash.unmineable.com:3333'; worker = 'leafdriving2.unmineable_miner_miner1'; build = 'SRBMiner 3.8.0'; util = '100%'; vram_used = '1915 MiB'; temp_c = 49; power_w = 42.69; clock_mhz = 1890 }
  notes  = 'SRBMiner 3.8.6 refuses this card ("GPU recovery failed; ref=RDEB6381D"); 3.8.0 mines. Driver 472.80 (Windows Update) could not load the CUDA kernels; 591.86 is the Turing branch and also lifts llama.cpp 4x.'
}
$rows += [pscustomobject]$row

$out = @()
foreach ($r in $rows) { $out += ($r | ConvertTo-Json -Depth 8 -Compress) }
$out | Set-Content -Path $f -Encoding UTF8
'ROWS: {0}' -f $out.Count
Get-Content $f | ForEach-Object { '  ' + $_.Substring(0, [Math]::Min(160, $_.Length)) + ' ...' }
