# The node.json I just wrote has a UTF-8 BOM (PowerShell 5.1's Set-Content -Encoding UTF8 adds one), and node refuses it:
# "Unexpected token '\uFEFF'". Rewrite it without a BOM and prove the publisher can read it.
$ErrorActionPreference = 'Continue'
$nj = 'C:\AI\hydra-local\module\Menu\data\node.json'
$text = [System.IO.File]::ReadAllText($nj)
$j = $text | ConvertFrom-Json
$clean = $j | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($nj, $clean, (New-Object System.Text.UTF8Encoding($false)))
$bytes = [System.IO.File]::ReadAllBytes($nj)
'first three bytes: {0} {1} {2}  (239 187 191 would be a BOM)' -f $bytes[0], $bytes[1], $bytes[2]
'miner block: ' + ($j.miner | ConvertTo-Json -Compress)
'NOBOM DONE'
