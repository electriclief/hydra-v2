$ErrorActionPreference = 'Continue'
'== hashes of the GGUF files on miner1 (before they are deleted)'
foreach ($f in 'C:\AI\models\qwen2.5-3b-q4km.gguf', 'C:\AI\models\qwen2.5-0.5b-q4km.gguf', 'C:\AI\models\qwen2.5-7b-q4km.gguf') {
  if (Test-Path $f) {
    $h = (Get-FileHash $f -Algorithm SHA256).Hash.ToLower()
    $b = (Get-Item $f).Length
    '  {0}' -f (Split-Path $f -Leaf)
    '    {0} bytes' -f $b
    '    {0}' -f $h
  } else { '  {0}: absent' -f (Split-Path $f -Leaf) }
}
'HASH DONE'
