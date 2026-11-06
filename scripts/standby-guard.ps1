param(
  [string]$MinerTask = 'Hydra-Miner',
  [int]$PollSeconds = 15,
  [int]$ResumeGraceSeconds = 45,
  [string]$DataDir = 'C:\AI\hydra-local\data\standby',
  [string]$StateUrl = 'http://127.0.0.1:8127',
  [string]$EventUrl = 'http://127.0.0.1:8126',
  [string]$Ref = '',
  [string[]]$AiProcs = @('audiocpp_cli','audiocpp_server','audiocpp_gguf','llama-server','llama-cli','sd-server','sd')
)

# ── THE INTERIM IDLE SERVICE, for one node ──────────────────────────────────────
# Rule: AI work always wins. If any AI process is alive the miner is stopped; when the
# node has been free for $ResumeGraceSeconds the miner comes back. A pin file forces the
# miner to stay up.
#
# This runs as a DECLARED watchdog inside the Hydra shell (Basic_App/electron/main.cjs,
# WATCHDOG_TABLE) so it appears in the Process tab and dies when the window closes.
# It must never be installed as a scheduled task or a Startup-folder script.

$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$LogPath   = Join-Path $DataDir 'guard.log'
$StatePath = Join-Path $DataDir 'guard.state.json'
$PinFile   = Join-Path $DataDir 'standby.pin'

function LogIt($msg) {
  $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $msg
  Add-Content -Path $LogPath -Value $line -Encoding ascii
  Write-Output $line
}

# Every happening goes through the Event_Handler: the file log is for a person reading this box, the event log is
# the fleet's record. Names are declared in Event_Handler/data/palette.json so an out-of-process producer like
# this guard can fire them; a missing palette entry is reported once, never guessed around.
function Send-Event([string]$Name, [hashtable]$Payload) {
  try {
    $body = @{ name = $Name; payload = $Payload; source = 'system' } | ConvertTo-Json -Depth 5 -Compress
    Invoke-RestMethod -Uri ($EventUrl + '/api/events/trigger') -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 3 | Out-Null
  }
  catch {
    LogIt ("event " + $Name + " not recorded: " + $_.Exception.Message)
  }
}

function Get-ProcessCmd([int]$id) {
  try { (Get-CimInstance Win32_Process -Filter ("ProcessId=" + $id)).CommandLine } catch { '' }
}

function Get-GpuLayers([string]$cmd) {
  if ($cmd -match '--n-gpu-layers\s+(\d+)') { return [int]$Matches[1] }
  if ($cmd -match '-ngl\s+(\d+)') { return [int]$Matches[1] }
  return $null
}

# A server is not a job. llama-server/sd-server sit loaded and answer requests, so their presence says a model
# is in memory, not that the card is busy. Batch tools (llama-cli, audiocpp_cli, sd) exist only while they work,
# so for them presence IS work. This distinction is the whole reason mining was being stopped by idle servers.
function Test-ServerProcessing([string]$cmd) {
  if ($cmd -notmatch '--port\s+(\d+)') { return $null }
  $port = [int]$Matches[1]
  try {
    $slots = Invoke-RestMethod -Uri ("http://127.0.0.1:" + $port + "/slots") -TimeoutSec 2
    foreach ($s in @($slots)) {
      if ($s.PSObject.Properties['is_processing'] -and $s.is_processing) { return $true }
    }
    return $false
  }
  catch {
    # a server that cannot answer /slots is starting or wedged: unknown, and unknown is not idle
    return $null
  }
}

function Get-AiWork {
  $rows = @()
  foreach ($n in $AiProcs) {
    $ps = @(Get-Process -Name $n -ErrorAction SilentlyContinue)
    if ($ps.Count -eq 0) { continue }
    $server = $n -like '*server'
    $gpuByDefault = @('sd-server', 'audiocpp_server') -contains $n
    foreach ($p in $ps) {
      $cmd = Get-ProcessCmd $p.Id
      $port = 0
      if ($cmd -match '--port\s+(\d+)') { $port = [int]$Matches[1] }
      $busy = $true
      if ($server) { $busy = Test-ServerProcessing $cmd }
      $layers = Get-GpuLayers $cmd
      $gpu = $true
      if ($server -and -not $gpuByDefault) { $gpu = ($null -ne $layers -and $layers -gt 0) }
      $rows += [pscustomobject]@{
        name = $n; pid = $p.Id; port = $port
        kind = $(if ($server) { 'server' } else { 'job' })
        busy = $busy; gpu = $gpu; ngl = $layers
      }
    }
  }
  return $rows
}

# one readable word per process, so the footer and the LAN row say WHY a card is busy or not
function Describe-AiWork($rows) {
  $out = @()
  foreach ($r in $rows) {
    $state = 'working'
    if ($r.busy -eq $false) { $state = 'idle' } elseif ($null -eq $r.busy) { $state = 'unknown' }
    $where = $(if ($r.gpu) { 'gpu' } else { 'cpu' })
    $out += ($r.name + '(' + $r.pid + $(if ($r.port) { ',:' + $r.port } else { '' }) + ',' + $where + ',' + $state + ')')
  }
  return $out
}

function Format-Rate([double]$v) {
  if ($v -ge 1e12) { return @([math]::Round($v / 1e12, 1), 'TH/s') }
  if ($v -ge 1e9) { return @([math]::Round($v / 1e9, 1), 'GH/s') }
  if ($v -ge 1e6) { return @([math]::Round($v / 1e6, 1), 'MH/s') }
  if ($v -ge 1e3) { return @([math]::Round($v / 1e3, 1), 'kH/s') }
  return @([math]::Round($v, 0), 'H/s')
}

function Get-AlgoLabel([string]$algo) {
  switch ($algo) {
    'pearlhash' { return 'PearlPow' }
    'xelishashv3' { return 'XelisHashV3' }
    'kawpow' { return 'KawPow' }
    default { return $algo }
  }
}

# What the Idle Service is actually doing, asked of the miner rather than assumed. SRBMiner publishes a JSON
# summary on its own listening port; the port is random per launch, so it is looked up from the process.
# Nothing found means null - the display then says "mining" without inventing an algorithm or a rate.
function Get-MinerDetail {
  $p = Get-Process -Name 'SRBMiner-MULTI' -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $p) { return $null }
  $port = 0
  try {
    $c = Get-NetTCPConnection -OwningProcess $p.Id -State Listen -ErrorAction Stop | Select-Object -First 1
    $port = [int]$c.LocalPort
  }
  catch { return $null }
  if ($port -le 0) { return $null }
  try {
    $j = Invoke-RestMethod -Uri ("http://127.0.0.1:" + $port + "/") -TimeoutSec 3
    $a = @($j.algorithms) | Select-Object -First 1
    if (-not $a) { return $null }
    $rate = [double]$a.hashrate.'1min'
    $f = Format-Rate $rate
    return @{
      algo     = [string]$a.name
      label    = (Get-AlgoLabel ([string]$a.name))
      rate     = $f[0]
      unit     = $f[1]
      accepted = [int]$a.shares.accepted
      rejected = [int]$a.shares.rejected
      pool     = [string]$a.pool.pool
      at       = (Get-Date).ToString('s')
    }
  }
  catch { return $null }
}

function Get-MinerRunning {
  $t = schtasks /query /tn $MinerTask /fo list 2>$null | Out-String
  if ($t -match 'Running') { return $true }
  foreach ($n in @('unMiner','SRBMiner-MULTI','lolMiner','xmrig','pearl')) {
    if (Get-Process -Name $n -ErrorAction SilentlyContinue) { return $true }
  }
  return $false
}

function Stop-Miner {
  schtasks /end /tn $MinerTask 2>$null | Out-Null
  Start-Sleep -Seconds 2
  foreach ($n in @('unMiner','SRBMiner-MULTI','lolMiner','xmrig')) {
    Get-Process -Name $n -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  }
  LogIt "YIELD  miner stopped for AI work"
}

function Start-Miner {
  $r = schtasks /run /tn $MinerTask 2>$null | Out-String
  if ($r -match 'SUCCESS') { LogIt "RESUME  miner started" } else { LogIt ("RESUME failed: " + $r.Trim()) }
}

LogIt "guard start  poll ${PollSeconds}s  grace ${ResumeGraceSeconds}s  task=$MinerTask"

# ── who this guard speaks for ──────────────────────────────────────────────────
# The Idle Service OWNS node.<ref>.standby and publishes it to State itself. No other module relays it: if this
# guard stops, its branch goes stale on its own schedule and every screen can see that, instead of a neighbour
# keeping a dead miner looking alive.
if (-not $Ref) {
  foreach ($p in @('C:\AI\hydra-local\module\Core\data\node.json','C:\AI\hydra-local\module\Menu\data\node.json')) {
    if (Test-Path $p) {
      try { $Ref = (Get-Content $p -Raw | ConvertFrom-Json).ref } catch { $Ref = $null }
      if ($Ref) { break }
    }
  }
}
if (-not $Ref) { $Ref = 'node'; LogIt 'WARN  no node.json ref found - publishing as node.node.standby' }
$StandbyName = "node.$Ref.standby"
LogIt "owns $StandbyName -> $StateUrl"

$freeSince = $null
$busySince = $null
$wasPinned = $false
$lastMode = $null
$lastPublishError = $null

while ($true) {
  $pinned = Test-Path $PinFile
  $ai = @(Get-AiWork)
  $miner = Get-MinerRunning

  # Work that needs the card: a batch job, or a server with a request in flight on GPU layers. An idle server
  # holding a model is parked, not working - it does not get to stop the miner and it does not get a timer.
  $preempt = @($ai | Where-Object { $_.gpu -and ($_.busy -ne $false) })

  if ($preempt.Count -gt 0) {
    if ($null -eq $busySince) { $busySince = Get-Date }
    $freeSince = $null
    if (-not $pinned -and $miner) {
      Stop-Miner
      Send-Event 'standby.yield' @{ ref = $Ref; ai = (@(Describe-AiWork $preempt) -join ','); at = (Get-Date).ToString('s') }
    }
  }
  else {
    $busySince = $null
    if ($null -eq $freeSince) { $freeSince = Get-Date }
    $idleFor = ((Get-Date) - $freeSince).TotalSeconds
    if (-not $miner -and $idleFor -ge $ResumeGraceSeconds) {
      if ($pinned) { LogIt "pinned - miner left alone" }
      else {
        Start-Miner
        Send-Event 'standby.resume' @{ ref = $Ref; idleForS = [int]$idleFor; at = (Get-Date).ToString('s') }
        $freeSince = Get-Date
      }
    }
  }

  # The countdown belongs to the guard, because the guard owns the timer. A reader that recomputes it would drift
  # from the thing that actually restarts the miner.
  $resumeAt = $null
  if ($null -ne $freeSince -and -not $miner -and -not $pinned) {
    $resumeAt = $freeSince.AddSeconds($ResumeGraceSeconds).ToString('s')
  }

  $mode = 'idle'
  if ($preempt.Count -gt 0) { $mode = 'ai' } elseif ($miner) { $mode = 'mining' }

  # the algorithm and rate belong to the same report as the mode: both come from the thing doing the work
  $minerDetail = $null
  if ($mode -eq 'mining') { $minerDetail = Get-MinerDetail }

  # a change of mode is the one thing worth a log line: it is what the operator watches for
  if ($mode -ne $lastMode) {
    LogIt ("mode -> " + $mode + "  [" + ((@(Describe-AiWork $ai)) -join ' ') + "]")
    $lastMode = $mode
  }

  # a pin is an operator decision, so it is announced when it changes rather than repeated every poll
  if ($pinned -ne $wasPinned) {
    Send-Event 'standby.pin' @{ ref = $Ref; pinned = $pinned; at = (Get-Date).ToString('s') }
    $wasPinned = $pinned
  }

  $st = @{
    at         = (Get-Date).ToString('s')
    owner      = 'idle-service'
    ref        = $Ref
    mode       = $mode
    ai         = (@(Describe-AiWork $ai) -join ',')
    working    = $preempt.Count
    parked     = ($ai.Count - $preempt.Count)
    minerDetail = $minerDetail
    miner      = $miner
    pinned     = $pinned
    busySince  = $(if ($null -ne $busySince) { $busySince.ToString('s') } else { $null })
    idleSince  = $(if ($null -ne $freeSince) { $freeSince.ToString('s') } else { $null })
    resumeAt   = $resumeAt
    grace      = $ResumeGraceSeconds
    poll       = $PollSeconds
  }
  ($st | ConvertTo-Json -Depth 5 -Compress) | Set-Content -Path $StatePath -Encoding ascii

  # Publish to the node's own State: the footer and every other screen read THIS, not a file they cannot reach.
  try {
    $body = @{ name = $StandbyName; content = $st } | ConvertTo-Json -Depth 5 -Compress
    Invoke-RestMethod -Uri ($StateUrl + '/api/state/register') -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 3 | Out-Null
    if ($lastPublishError) { LogIt "state publish recovered"; $lastPublishError = $null }
  }
  catch {
    $msg = $_.Exception.Message
    # log a change, not every tick: a State door that is down must not fill the log with the same line
    if ($msg -ne $lastPublishError) { LogIt ("state publish failed: " + $msg); $lastPublishError = $msg }
  }

  Start-Sleep -Seconds $PollSeconds
}
