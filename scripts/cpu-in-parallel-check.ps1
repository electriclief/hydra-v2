# =====================================================================================
#  CPU-IN-PARALLEL-CHECK - is the CPU really hashing beside the card, and does the guard now report both?
#
#  Restarts the guard row from ITS OWN recorded command line (no second copy of the launch string to drift), then reads
#  what the world can see: xmrig's API, SRBMiner's API, the ProcessWrapper rows, and the standby payload the guard
#  publishes to State.
# =====================================================================================
$ErrorActionPreference = 'Continue'
$pw = 'http://127.0.0.1:8125'
$state = 'http://127.0.0.1:8127'

function Row($name) {
  ((Invoke-RestMethod "$pw/api/processes" -TimeoutSec 5).processes) | Where-Object { $_.name -eq $name } | Select-Object -First 1
}

'=== before: who is hashing'
$x = Invoke-RestMethod 'http://127.0.0.1:60131/2/summary' -TimeoutSec 5
'  cpu  ' + $x.algo + '  ' + [math]::Round($x.hashrate.'60s', 1) + ' H/s (60s)  ' + [math]::Round($x.hashrate.'10s', 1) + ' H/s (10s)  accepted ' + $x.results_shares_good + '/' + $x.results_shares_total + '  hugepages ' + $x.hugepages.percent
'  cpu  threads used: ' + ($x.cpu.threads | Measure-Object).Count + ' reported, ' + @($x.hashrate.total).Count + ' rate slots'
try {
  $s = Invoke-RestMethod 'http://127.0.0.1:60130/' -TimeoutSec 5
  $a = @($s.algorithms)[0]
  '  gpu  ' + $a.name + '  ' + [math]::Round(([double]$a.hashrate.'1min') / 1e6, 2) + ' MH/s  accepted ' + $a.shares.accepted
} catch { '  gpu  api not answering on 60130' }

''
'=== restarting the guard row so it runs the new code'
$g = Row 'standby-guard'
if (-not $g) { 'no standby-guard row - is this a mining node?'; return }
'  current row ' + $g.id + ' pid ' + $g.pid + ' command ' + $g.command
$cmd = [string]$g.command
$argsList = @()
if ($g.args) { foreach ($a in @($g.args)) { $argsList += [string]$a } }
$cwd = [string]$g.cwd
[void](Invoke-RestMethod "$pw/api/processes/$($g.id)/kill" -Method Post -ContentType 'application/json' -Body '{"force":true}' -TimeoutSec 15)
Start-Sleep -Seconds 3
$body = @{ name = 'standby-guard'; tag = [string]$g.tag; isolation = 'supervised'; command = $cmd; cwd = $cwd } | ConvertTo-Json -Depth 4
$b2 = ($body | ConvertFrom-Json)
if ($argsList.Count -gt 0) { $b2 | Add-Member -NotePropertyName args -NotePropertyValue $argsList -Force }
$r = Invoke-RestMethod "$pw/api/processes" -Method Post -ContentType 'application/json' -Body ($b2 | ConvertTo-Json -Depth 5) -TimeoutSec 20
'  raised ' + $r.process.id + ' pid ' + $r.process.pid
Start-Sleep -Seconds 12

''
'=== rows now (both miners must be there, both with close buttons)'
((Invoke-RestMethod "$pw/api/processes" -TimeoutSec 5).processes) | Where-Object { $_.tag -eq 'standby' -or $_.name -like '*miner*' } |
  ForEach-Object { '  {0,-22} {1,-9} pid {2,-6} {3}' -f $_.name, $_.life, $_.pid, $_.command }

''
'=== what the guard published to State'
try {
  $ref = (Get-Content 'C:\AI\hydra-local\module\Menu\data\node.json' -Raw | ConvertFrom-Json).ref
  $p = Invoke-RestMethod "$state/api/state/pull?name=node.$ref.standby" -TimeoutSec 5
  $c = $p.content
  '  mode       : ' + $c.mode
  '  gpu detail : ' + ($c.minerDetail | ConvertTo-Json -Compress)
  '  cpu detail : ' + ($c.cpuDetail | ConvertTo-Json -Compress)
  '  cpu enabled: ' + $c.cpu
} catch { '  state pull failed: ' + $_.Exception.Message }
