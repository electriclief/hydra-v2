# All three GGUF files are verified present on the controller with identical SHA256:
#   3B   9c9f56a391a3abbd5b89d0245bf6106081bcc3173119d4229235dd9d23253f94   -> C:\AI\models\qwen2.5-3b-q4km.gguf
#   0.5B 74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db   -> C:\AI\models\qwen2.5-0.5b-q4km.gguf
#   7B   65b8fcd92af6b4fefa935c625d1ac27ea29dcb6ee14589c55a8f115ceaaa1423   -> C:\AI\fleet\serve\Qwen2.5-7B-Instruct-Q4_K_M.gguf
# With the copies proven, the models leave miner1 for good.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$v0 = Get-Volume -DriveLetter C
Section 'before'
'  C: used {0:N1} GB   free {1:N1} GB' -f (($v0.Size - $v0.SizeRemaining) / 1GB), ($v0.SizeRemaining / 1GB)

Section 'delete the models and any llama leftovers'
foreach ($p in 'C:\AI\models', 'C:\AI\llama') {
  if (Test-Path $p) {
    $mb = [math]::Round((Get-ChildItem $p -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1MB, 1)
    Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue
    '  {0,-14} {1,8:N0} MB  -> {2}' -f $p, $mb, $(if (Test-Path $p) { 'still present' } else { 'gone' })
  } else { '  {0,-14} already gone' -f $p }
}

Section 'verify nothing that matters went with them'
foreach ($k in 'C:\AI\miners', 'C:\AI\logs', 'C:\AI\tools\mine-overnight.ps1') { '  {0,-34} {1}' -f $k, $(if (Test-Path $k) { 'present' } else { 'MISSING' }) }
'  mining task: ' + (Get-ScheduledTask -TaskName 'HydraMine1' -ErrorAction SilentlyContinue).State

$v1 = Get-Volume -DriveLetter C
Section 'after'
'  C: used {0:N1} GB   free {1:N1} GB' -f (($v1.Size - $v1.SizeRemaining) / 1GB), ($v1.SizeRemaining / 1GB)
'  this step reclaimed {0:N2} GB' -f (((($v0.Size - $v0.SizeRemaining) - ($v1.Size - $v1.SizeRemaining)) / 1GB))
Section 'top of C: now'
Get-ChildItem 'C:\AI' -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  $s = [math]::Round((Get-ChildItem $_.FullName -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1MB, 1)
  '  {0,-16} {1,9:N0} MB' -f $_.Name, $s
}
try { $a = Invoke-RestMethod 'http://127.0.0.1:60220/' -TimeoutSec 8; $alg = @($a.algorithms)[0]; '  hashrate: {0:N0} H/s  A{1} R{2}' -f $alg.hashrate.'15min', $alg.shares.accepted, $alg.shares.rejected } catch { '  api: ' + $_.Exception.Message }
'MODELS-GONE DONE'
