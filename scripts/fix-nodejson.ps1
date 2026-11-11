# Correct the card declaration on this node: the operator's own note says RX 570, and the wall reads the
# card name from this file - so the wall was wrong because the DECLARATION was wrong, not the drawing.
$ErrorActionPreference = 'Stop'
$p = 'C:\AI\hydra-local\module\Menu\data\node.json'
$j = Get-Content $p -Raw | ConvertFrom-Json
'before: ' + $j.gpu
$j.gpu = 'Radeon RX 570, 8 GB (gfx803/polaris10)'
$json = $j | ConvertTo-Json -Depth 20
# no BOM: every other reader in this repo parses these files strictly
[System.IO.File]::WriteAllText($p, $json, (New-Object System.Text.UTF8Encoding($false)))
$check = Get-Content $p -Raw | ConvertFrom-Json
'after:  ' + $check.gpu
'parses: ' + ($check.ref -ne $null)
