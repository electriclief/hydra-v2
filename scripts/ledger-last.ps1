# Ledger state: what the last bench row says, and whether the newer run ever wrote one.
$ErrorActionPreference = 'Continue'
$f = 'C:\AI\reports\miner1-cards.jsonl'
if (Test-Path $f) {
  'file  : {0}  ({1} rows, modified {2})' -f $f, (@(Get-Content $f).Count), (Get-Item $f).LastWriteTime
  $last = Get-Content $f -Tail 1
  $o = $last | ConvertFrom-Json
  'when  : ' + $o.when
  'gpu   : {0} · driver {1} · {2} MB' -f $o.gpus[0].name, $o.gpus[0].driver, $o.gpus[0].vram_mb
  'link  : width {0} speed {1}' -f $o.links[1].width, $o.links[1].speed
  'llama : pp256 {0}  tg64 {1}' -f $o.llama.pp256, $o.llama.tg64
  'miner : {0}  {1} H/s  accepted {2} rejected {3}' -f $o.miner.algo, $o.miner.hash, $o.miner.accepted, $o.miner.rejected
} else { 'no ledger file' }
'now   : ' + (Get-Date).ToString('HH:mm:ss')
