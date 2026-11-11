# Same publisher, second node: the monitor should show the mining on every node that mines, not just the one we fixed today.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$root = 'C:\AI\hydra-local'
$mjs = Join-Path $root 'scripts\monitor-mining.mjs'

Section '1. node binary'
$nodePath = ''
$p = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ExecutablePath } | Select-Object -First 1)
if ($p.Count) { $nodePath = [string]$p[0].ExecutablePath }
if (-not $nodePath -and (Test-Path (Join-Path $root 'tools\node\node.exe'))) { $nodePath = Join-Path $root 'tools\node\node.exe' }
$cmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodePath -and $cmd) { $nodePath = $cmd.Source }
'  node: ' + $(if ($nodePath) { $nodePath } else { 'NOT FOUND' })
'  publisher present: ' + (Test-Path $mjs)
if (-not $nodePath -or -not (Test-Path $mjs)) { '  cannot continue'; exit 1 }

Section '2. what this node declares'
$nj = Join-Path $root 'module\Menu\data\node.json'
$j = Get-Content $nj -Raw | ConvertFrom-Json
'  ref: ' + $j.ref + '   apiport: ' + ((($j.standby.start.args) -join ' '))

Section '3. one shot'
& $nodePath $mjs --root $root --echidna 8138 --once 2>&1 | ForEach-Object { '  ' + $_ }

Section '4. the card on the board'
$mon = Join-Path $root 'module\Echidna\data\monitor.json'
if (Test-Path $mon) {
  $m = Get-Content $mon -Raw | ConvertFrom-Json
  $c = @($m.stack)[$m.index]
  if ($c) { '  newest: [{0}] {1} — {2}' -f $c.kind, $c.title, $c.text } else { '  empty' }
} else { '  monitor.json missing' }

Section '5. supervised row'
@((Invoke-RestMethod 'http://127.0.0.1:8125/api/processes' -TimeoutSec 8).processes | Where-Object { $_.name -eq 'monitor-mining' }) | ForEach-Object {
  try { Invoke-RestMethod -Method Post -Uri ('http://127.0.0.1:8125/api/processes/' + $_.id + '/kill') -Body '{"force":true}' -ContentType 'application/json' -TimeoutSec 10 | Out-Null; '  replaced ' + $_.id } catch { }
}
$body = @{
  name = 'monitor-mining'; tag = 'watch'; isolation = 'supervised'
  command = $nodePath
  args = @($mjs, '--root', $root, '--echidna', '8138', '--interval', '10')
  cwd = $root
} | ConvertTo-Json -Depth 4
try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8125/api/processes' -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 20; '  row {0} life {1}' -f $r.process.id, $r.process.life } catch { '  start failed: ' + $_.Exception.Message }
'MONITOR DEPLOY DONE'
