$ErrorActionPreference = 'Continue'
$nj = 'C:\AI\hydra-local\module\Menu\data\node.json'
$j = [System.IO.File]::ReadAllText($nj) | ConvertFrom-Json
if (-not $j.miner) {
  $j | Add-Member -NotePropertyName miner -NotePropertyValue ([pscustomobject]@{ apiPort = 60131; algo = 'pearl'; provider = 'unMiner -> SRBMiner-MULTI-380' })
  'added miner.apiPort 60131 (pearl)'
} else { 'miner block already: ' + ($j.miner | ConvertTo-Json -Compress) }
# no BOM: node refuses a JSON file that starts with one, and PowerShell 5.1's Set-Content adds it
[System.IO.File]::WriteAllText($nj, ($j | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
$b = [System.IO.File]::ReadAllBytes($nj)
'first bytes {0} {1} {2}' -f $b[0], $b[1], $b[2]
'standby start: ' + $j.standby.start.command
'1660 JSON DONE'
