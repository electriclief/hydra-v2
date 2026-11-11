$ErrorActionPreference = 'Continue'
$nj = 'C:\AI\hydra-local\module\Menu\data\node.json'
$j = Get-Content $nj -Raw | ConvertFrom-Json
if (-not $j.miner) {
  $j | Add-Member -NotePropertyName miner -NotePropertyValue ([pscustomobject]@{ apiPort = 60130; cpuApiPort = 60131 })
  $j | ConvertTo-Json -Depth 6 | Set-Content $nj -Encoding UTF8
  'added miner.apiPort 60130 (SRBMiner quantus) and cpuApiPort 60131 (xmrig)'
} else {
  'miner block already present: ' + ($j.miner | ConvertTo-Json -Compress)
}
'ROBERT PORT DONE'
