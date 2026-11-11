# The standby row failed with "spawn EINVAL": node.json named a .cmd and ProcessWrapper spawns with shell:false,
# so there was no interpreter to run it. Point the policy straight at lolMiner.exe instead, clear the dead row,
# then launch it through the door and let the guard adopt it (Sync-StandbyToPw) rather than fighting it.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section '1. new standby block from node.json'
$nj = 'C:\AI\hydra-local\module\Menu\data\node.json'
$j = Get-Content $nj -Raw | ConvertFrom-Json
'  current command: ' + $j.standby.start.command
Copy-Item 'C:\Users\User\xpsw-node.json' $nj -Force
$j = Get-Content $nj -Raw | ConvertFrom-Json
'  new command    : ' + $j.standby.start.command
'  args           : ' + ($j.standby.start.args -join ' ')
'  parses: yes   after=' + $j.standby.after

Section '2. clear the dead row'
$rows = (Invoke-RestMethod 'http://127.0.0.1:8125/api/processes' -TimeoutSec 8).processes
$dead = @($rows | Where-Object { $_.name -eq 'standby-miner' })
foreach ($d in $dead) {
  '  ' + $d.id + ' life=' + $d.life + ' error=' + $d.error
  try { Invoke-RestMethod -Method Delete ("http://127.0.0.1:8125/api/processes/" + $d.id) -TimeoutSec 8 | Out-Null; '    deleted' } catch { '    delete refused: ' + $_.Exception.Message }
}

Section '3. launch it through ProcessWrapper (the same body the guard sends)'
$body = @{ name = 'standby-miner'; tag = 'standby'; isolation = 'supervised'; command = $j.standby.start.command; args = @($j.standby.start.args); cwd = $j.standby.start.cwd } | ConvertTo-Json -Depth 4
try {
  $r = Invoke-RestMethod -Method Post 'http://127.0.0.1:8125/api/processes' -Body $body -ContentType 'application/json' -TimeoutSec 20
  '  row: ' + $r.process.id + '  duplicate=' + $r.duplicate
} catch { '  POST failed: ' + $_.Exception.Message }

Section '4. is it hashing'
for ($i = 1; $i -le 10; $i++) {
  Start-Sleep -Seconds 15
  $alive = @(Get-Process lolMiner -ErrorAction SilentlyContinue).Count
  $rate = 'api?'
  try { $a = Invoke-RestMethod 'http://127.0.0.1:60151/' -TimeoutSec 5; $w = @($a.Workers)[0]; if ($w) { $rate = $w.Name + ' ' + $w.Performance_Summary } } catch { }
  $temp = ((& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=temperature.gpu,power.draw --format=csv,noheader) -join '')
  '  t{0,3}s  lolMiner={1}  {2}  gpu {3}' -f ($i*15), $alive, $rate, $temp
  if ($alive -eq 1 -and $rate -ne 'api?') { break }
}
Section '5. guard log tail'
foreach ($f in 'C:\AI\logs\guard.log','C:\AI\hydra-local\logs\guard.log','C:\AI\logs\standby-guard.log') {
  if (Test-Path $f) { '  --- ' + $f; Get-Content $f -Tail 5 | ForEach-Object { '    ' + ($_ -replace '\s+',' ').Trim() } }
}
'XPSW MINER DONE'
