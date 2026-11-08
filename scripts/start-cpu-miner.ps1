# =====================================================================================
#  START-CPU-MINER - raise the CPU miner the way the idle service would: a ProcessWrapper row, tagged standby.
#
#  Why this exists next to the guard: the guard only calls Start-Miner on an idle transition, so a node that is already
#  mining never gets its CPU half. This is the one-shot that closes that gap by hand, reading the SAME node.json block
#  the guard reads (standby.cpu) - no second copy of the command, no arguments that drift.
#
#  Adopt-safe: if xmrig is already running it is left alone; if a standby-cpu row already exists it is reused.
# =====================================================================================
param([string]$Root = 'C:\AI\hydra-local', [switch]$DryRun)
$ErrorActionPreference = 'Continue'

$nodeJson = @(
  (Join-Path $Root 'module\Core\data\node.json'),
  (Join-Path $Root 'module\Menu\data\node.json')
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $nodeJson) { throw 'no node.json - this box declares no idle policy' }
$j = Get-Content $nodeJson -Raw | ConvertFrom-Json
$c = $j.standby.cpu
if (-not $c -or -not $c.enabled) { 'the CPU miner is not declared/enabled in ' + $nodeJson; return }

'command : ' + $c.command
'args    : ' + (@($c.args) -join ' ')
'apiPort : ' + $c.apiPort
if ($DryRun) { return }
if (-not (Test-Path $c.command)) { throw ('the declared command is not on disk: ' + $c.command) }

$pw = 'http://127.0.0.1:8125'
$rows = $null
try { $rows = (Invoke-RestMethod "$pw/api/processes" -TimeoutSec 5).processes } catch { 'the wrapper is not answering - starting a plain process instead' }

if (@(Get-Process -Name 'xmrig' -ErrorAction SilentlyContinue).Count -gt 0) {
  'xmrig is already hashing - left alone'
  return
}
if ($rows) {
  $existing = $rows | Where-Object { $_.name -eq 'standby-cpu' -and ($_.life -eq 'running' -or $_.life -eq 'starting') } | Select-Object -First 1
  if ($existing) { 'standby-cpu row already running: ' + $existing.id + ' pid ' + $existing.pid; return }

  $body = @{
    name       = 'standby-cpu'
    tag        = 'standby'
    isolation  = 'supervised'
    command    = [string]$c.command
    args       = @($c.args | ForEach-Object { [string]$_ })
    cwd        = [string]$c.cwd
  } | ConvertTo-Json -Depth 5
  try {
    $r = Invoke-RestMethod "$pw/api/processes" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 20
    'raised ' + $r.process.id + ' pid ' + $r.process.pid
  } catch {
    'the wrapper refused: ' + $_.Exception.Message
    Start-Process -FilePath $c.command -ArgumentList @($c.args) -WorkingDirectory $c.cwd -WindowStyle Hidden
    'started a plain process instead'
  }
} else {
  Start-Process -FilePath $c.command -ArgumentList @($c.args) -WorkingDirectory $c.cwd -WindowStyle Hidden
  'started a plain process (no wrapper)'
}

# wait for its own API: a miner that has not opened its port has not started, whatever the process list says
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 2
  try {
    $s = Invoke-RestMethod ('http://127.0.0.1:' + $c.apiPort + '/2/summary') -TimeoutSec 3
    'api up: ' + $s.algo + '  ' + [math]::Round($s.hashrate.'10s', 0) + ' H/s  threads ' + $s.cpu.threads + '  pool ' + $s.connection.pool
    break
  } catch { }
}
