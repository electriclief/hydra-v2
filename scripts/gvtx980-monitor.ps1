# Put the mining story on the Hydra MONITOR for this node, and keep the console wall as the thing a person stands in front of.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$root = 'C:\AI\hydra-local'
$mjs = Join-Path $root 'scripts\monitor-mining.mjs'

Section '1. which node binary can run it'
$nodePath = ''
$p = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ExecutablePath } | Select-Object -First 1)
if ($p.Count) { $nodePath = [string]$p[0].ExecutablePath }
if (-not $nodePath -and (Test-Path (Join-Path $root 'tools\node\node.exe'))) { $nodePath = Join-Path $root 'tools\node\node.exe' }
$cmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodePath -and $cmd) { $nodePath = $cmd.Source }
'  node: ' + $(if ($nodePath) { $nodePath } else { 'NOT FOUND' })
'  monitor-mining.mjs present: ' + (Test-Path $mjs)
if (-not $nodePath -or -not (Test-Path $mjs)) { '  cannot continue'; exit 1 }

Section '2. one shot, to prove the contract before supervising it'
& $nodePath $mjs --root $root --echidna 8138 --once 2>&1 | ForEach-Object { '  ' + $_ }

Section '3. did a card actually land on the board?'
$mon = Join-Path $root 'module\Echidna\data\monitor.json'
if (Test-Path $mon) {
  $j = Get-Content $mon -Raw | ConvertFrom-Json
  $cards = @($j.stack)
  '  cards on the stack: ' + $cards.Count + '  showing index ' + $j.index
  $c = $cards[$j.index]
  if ($c) { '  newest: [{0}] {1} — {2}' -f $c.kind, $c.title, $c.text } else { '  empty board' }
} else { '  monitor.json missing' }

Section '4. supervise it in ProcessWrapper (visible, closable), not as a loose process'
$existing = @((Invoke-RestMethod 'http://127.0.0.1:8125/api/processes' -TimeoutSec 8).processes | Where-Object { $_.name -eq 'monitor-mining' })
foreach ($e in $existing) {
  try { Invoke-RestMethod -Method Post -Uri ('http://127.0.0.1:8125/api/processes/' + $e.id + '/kill') -Body '{"force":true}' -ContentType 'application/json' -TimeoutSec 10 | Out-Null; '  replaced old row ' + $e.id } catch { }
}
$body = @{
  name = 'monitor-mining'; tag = 'watch'; isolation = 'supervised'
  command = $nodePath
  args = @($mjs, '--root', $root, '--echidna', '8138', '--interval', '10')
  cwd = $root
} | ConvertTo-Json -Depth 4
try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8125/api/processes' -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 20; '  row {0} life {1} dup {2}' -f $r.process.id, $r.process.life, $r.duplicate } catch { '  start failed: ' + $_.Exception.Message }

Section '5. rows now'
@((Invoke-RestMethod 'http://127.0.0.1:8125/api/processes' -TimeoutSec 8).processes) | Where-Object { $_.name -match 'standby|monitor' } | ForEach-Object { '  {0,-16} {1,-9} pid {2}' -f $_.name, $_.life, $_.pid }
'GVTX980 MONITOR DONE'
