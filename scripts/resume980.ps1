# .134 is idle: the autolykos2 test failed with "error in allocating memory 400" and the pin did not restart the miner
# (the guard treats the pin as "do not stop it", not "start it"). Start the miner as a ProcessWrapper row so the guard
# adopts it - that is how it was running for 24 h before I touched it.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$spec = @{
  command  = 'C:\AI\miners\lolminer\lolMiner.exe'
  args     = @('--algo','ETCHASH','--pool','etchash.unmineable.com:3333',
               '--user','leafdriving2.unmineable_miner_gtx980','--apiport','61235','--log','on')
  name     = 'standby-miner'
  cwd      = 'C:\AI\miners\lolminer'
  tag      = 'standby'
} | ConvertTo-Json -Depth 4 -Compress

Section 'ask ProcessWrapper to start the miner'
try {
  $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8125/api/processes' -Method Post -Body $spec -ContentType 'application/json' -TimeoutSec 20
  '  row: ' + $r.process.id + '  life: ' + $r.process.life + '  pid: ' + $r.process.pid
} catch { '  POST failed: ' + $_.Exception.Message }

Section 'wait for the DAG and a rate'
for ($i = 1; $i -le 6; $i++) {
  Start-Sleep -Seconds 30
  try {
    $a = Invoke-RestMethod 'http://127.0.0.1:61235/' -TimeoutSec 8
    $g = @($a.GPUs)[0]
    '  t{0,4}s  {1,7:N2} MH/s  A{2} R{3}  power {4} W' -f ($i * 30), ($g.Performance_Summary / 1e6), $g.Shares_Accepted, $g.Shares_Rejected, [math]::Round($g.Power, 1)
  } catch { '  t{0,4}s  api: {1}' -f ($i * 30), $_.Exception.Message }
}
Section 'guard view'
try { $s = Get-Content 'C:\AI\hydra-local\data\standby\guard.state.json' -Raw | ConvertFrom-Json; '  mode {0}   miner {1}   pinned {2}   resumeAt {3}' -f $s.mode, $s.miner, $s.pinned, $s.resumeAt } catch { '  no state' }
Get-Content 'C:\AI\hydra-local\data\standby\guard.log' -Tail 5 | ForEach-Object { '  ' + $_ }
Section 'hardware'
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=utilization.gpu,power.draw,clocks.mem --format=csv,noheader
'RESUME980 DONE'
