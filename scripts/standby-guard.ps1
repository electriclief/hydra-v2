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

# The Scheduler owns "when is this node idle": it publishes node.<ref>.idle from its own book. This guard only
# EXECUTES that consequence - stop the standby when the book says work, start it when the book says quiet. A guard
# that invents its own timer is a second opinion about a fact it does not own, and the two drift.
function Get-IdleState {
  if (-not $Ref) { return $null }
  try {
    $r = Invoke-RestMethod -Uri ($StateUrl + '/api/state/pull?name=node.' + $Ref + '.idle') -TimeoutSec 3
    if ($r -and $r.content) { return $r.content }
  }
  catch { }
  return $null
}

function Get-MinerRunning {
  # Process presence is the truth. A scheduled task that still says "Running" with no children is a wrapper that
  # outlived its miner, and trusting it made the footer claim "mining" with nothing hashing.
  $procs = @(Get-Process -Name 'SRBMiner-MULTI', 'unMiner' -ErrorAction SilentlyContinue)
  if ($procs.Count -gt 0) { return $true }
  $t = schtasks /query /tn $MinerTask /fo list 2>$null | Out-String
  if ($t -match 'Running') {
    # give a just-launched task a moment before calling it dead: a restart takes a couple of seconds
    if ($null -eq $script:taskRunningSince) { $script:taskRunningSince = Get-Date }
    if (((Get-Date) - $script:taskRunningSince).TotalSeconds -lt 8) { return $true }
    return $false
  }
  $script:taskRunningSince = $null
  return $false
}

# --- ProcessWrapper: the miner must be a row in the table, not a thing behind schtasks -------------------------
$PwUrl = 'http://127.0.0.1:8125'
$StandbyTag = 'standby'

function Invoke-Pw {
  param([string]$Method, [string]$Path, $Body)
  try {
    if ($null -ne $Body) {
      $json = ($Body | ConvertTo-Json -Depth 6 -Compress)
      return Invoke-RestMethod -Uri ($PwUrl + $Path) -Method $Method -ContentType 'application/json' -Body $json -TimeoutSec 10
    }
    return Invoke-RestMethod -Uri ($PwUrl + $Path) -Method $Method -TimeoutSec 10
  }
  catch { return $null }
}

function Test-PwUp {
  return ($null -ne (Invoke-Pw -Method GET -Path '/health'))
}

function Get-PwStandby {
  $r = Invoke-Pw -Method GET -Path ('/api/processes?tag=' + $StandbyTag)
  if (-not $r) { return @() }
  return @($r.processes | Where-Object { $_.life -eq 'running' -or $_.life -eq 'starting' })
}

function Get-StandbyNames {
  if ($Policy -and $Policy.stop -and $Policy.stop.processes) { return @($Policy.stop.processes) }
  return @('unMiner', 'SRBMiner-MULTI', 'lolMiner', 'xmrig')
}

# Wrap whatever is already hashing. The operator's rule: a process manager must SEE a process that is already
# running, not only the ones it started - otherwise the app shows an idle card while the GPU is at 100%.
function Sync-StandbyToPw {
  if (-not (Test-PwUp)) { return $false }
  $known = @(Get-PwStandby | ForEach-Object { [int]$_.pid })
  $wrapped = 0
  foreach ($n in (Get-StandbyNames)) {
    foreach ($p in @(Get-Process -Name $n -ErrorAction SilentlyContinue)) {
      if ($known -contains $p.Id) { continue }
      $cmd = $null
      try { $cmd = $p.Path } catch { }
      $rec = Invoke-Pw -Method POST -Path '/api/processes/adopt' -Body @{
        pid    = $p.Id
        name   = $p.ProcessName
        tag    = $StandbyTag
        command = $cmd
      }
      if ($rec -and $rec.process) { $wrapped++; LogIt ("WRAP   " + $p.ProcessName + " pid " + $p.Id + " -> " + $rec.process.id) }
    }
  }
  return ($wrapped -gt 0)
}

function Stop-Miner {
  # stop through the table first: a process stopped behind the manager's back leaves a row that says 'running'
  if (Test-PwUp) {
    foreach ($rec in @(Get-PwStandby)) {
      $k = Invoke-Pw -Method POST -Path ('/api/processes/' + $rec.id + '/kill') -Body @{ force = $true }
      if ($k) { LogIt ("YIELD   stopped " + $rec.id + " through ProcessWrapper") }
      else { LogIt ("YIELD   ProcessWrapper would not stop " + $rec.id) }
    }
  }
  $task = $MinerTask
  $names = @('unMiner', 'SRBMiner-MULTI', 'lolMiner', 'xmrig')
  if ($Policy -and $Policy.stop) {
    if ($Policy.stop.task) { $task = [string]$Policy.stop.task }
    if ($Policy.stop.processes) { $names = @($Policy.stop.processes) }
  }
  schtasks /end /tn $task 2>$null | Out-Null
  Start-Sleep -Seconds 2
  foreach ($n in $names) {
    Get-Process -Name $n -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  }
  LogIt "YIELD  miner stopped for AI work"
}

# How this box is idle lives in the instance layer's node.json, never in this script: a guard with a hardcoded
# miner command cannot hold a different card busy. Re-read every few minutes so an edit takes effect without a
# restart, and fall back to the old hardcoded behaviour when the block is absent.
function Get-StandbyPolicy {
  foreach ($p in @('C:\AI\hydra-local\module\Core\data\node.json', 'C:\AI\hydra-local\module\Menu\data\node.json')) {
    if (Test-Path $p) {
      try {
        $j = Get-Content $p -Raw | ConvertFrom-Json
        if ($j.standby) { return $j.standby }
      }
      catch { }
    }
  }
  return $null
}

function Test-StandbyUp {
  # verified means the thing that earns is actually there, not that a launcher returned success
  if ($Policy -and $Policy.verify -and $Policy.verify.processes) {
    foreach ($n in @($Policy.verify.processes)) {
      if (Get-Process -Name $n -ErrorAction SilentlyContinue) { return $true }
    }
    return $false
  }
  return (Get-MinerRunning)
}

function Start-Miner {
  $script:lastVerify = 'pending'

  # WHERE the standby comes from: ProcessWrapper first, because a process the manager cannot see is the thing the
  # operator keeps objecting to. Wrap what is already hashing, else launch through the door so the row exists from
  # the first millisecond. The node.json start command stays as the fallback for a box with no wrapper running.
  $via = 'none'
  if (Test-PwUp) {
    if (Sync-StandbyToPw) {
      $via = 'wrapped'
      LogIt "RESUME  standby was already running - wrapped, no second copy"
    }
    elseif ($Policy -and $Policy.start -and $Policy.start.command) {
      $body = @{
        name      = 'standby-miner'
        tag       = $StandbyTag
        isolation = 'supervised'
        command   = [string]$Policy.start.command
      }
      $argList = @()
      if ($null -ne $Policy.start.args) {
        foreach ($a in @($Policy.start.args)) { if ($null -ne $a -and ([string]$a) -ne '') { $argList += [string]$a } }
      }
      if ($argList.Count -gt 0) { $body['args'] = $argList }
      if ($Policy.start.cwd) { $body['cwd'] = [string]$Policy.start.cwd }
      $launched = Invoke-Pw -Method POST -Path '/api/processes' -Body $body
      if ($launched -and $launched.process) {
        $via = 'wrapper'
        LogIt ("RESUME  launched through ProcessWrapper -> " + $launched.process.id)
      }
      else { LogIt "RESUME  ProcessWrapper refused the launch - falling back to node.json start" }
    }
  }

  if ($via -eq 'none') {
    if ($Policy -and $Policy.start -and $Policy.start.command) {
      $cmd = [string]$Policy.start.command
      # an empty JSON array arrives as $null, and Start-Process rejects a null ArgumentList outright. Build the list
      # element by element and omit the parameter entirely when there is nothing to pass.
      $directArgs = @()
      if ($null -ne $Policy.start.args) {
        foreach ($a in @($Policy.start.args)) { if ($null -ne $a -and ([string]$a) -ne '') { $directArgs += [string]$a } }
      }
      $wd = $null
      if ($Policy.start.cwd) { $wd = [string]$Policy.start.cwd }
      try {
        $procArgs = @{ FilePath = $cmd }
        if ($directArgs.Count -gt 0) { $procArgs['ArgumentList'] = $directArgs }
        if ($wd) { $procArgs['WorkingDirectory'] = $wd }
        Start-Process @procArgs
        LogIt "RESUME  standby launched (node.json start, no wrapper)"
      }
      catch {
        LogIt ("RESUME failed: " + $_.Exception.Message)
        $script:lastVerify = 'failed'
        return $false
      }
    }
    else {
      $procs = @(Get-Process -Name 'SRBMiner-MULTI', 'unMiner' -ErrorAction SilentlyContinue)
      if ($procs.Count -eq 0) {
        schtasks /end /tn $MinerTask 2>$null | Out-Null
        Start-Sleep -Milliseconds 600
      }
      $script:taskRunningSince = $null
      $r = schtasks /run /tn $MinerTask 2>$null | Out-String
      if ($r -match 'SUCCESS') { LogIt "RESUME  miner started (task)" } else { LogIt ("RESUME failed: " + $r.Trim()) }
    }
  }

  # A start that never produced the standby is a BLOCKED state, not a green one: report it as such instead of
  # letting the footer claim the card is earning while nothing does.
  $timeout = 60
  if ($Policy -and $Policy.verify -and $null -ne $Policy.verify.timeoutS) { $timeout = [int]$Policy.verify.timeoutS }
  $deadline = (Get-Date).AddSeconds($timeout)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    if (Test-StandbyUp) {
      LogIt ("RESUME verified after " + [int]((Get-Date) - $deadline.AddSeconds(-$timeout)).TotalSeconds + "s  via " + $via)
      $script:lastVerify = 'ok'
      # whatever path started it, the row must exist: wrap it now so the table and the tab agree
      if (Test-PwUp) { [void](Sync-StandbyToPw) }
      return $true
    }
  }
  LogIt ("RESUME BLOCKED  standby not up " + $timeout + "s after launch")
  $script:lastVerify = 'blocked'
  return $false
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
$tick = 0

# the standby policy is the node's, not this script's: read it before the first poll and refresh it periodically
$Policy = Get-StandbyPolicy
if ($Policy -and $null -ne $Policy.after) { $ResumeGraceSeconds = [int]$Policy.after }
if ($Policy -and $Policy.label) { LogIt ("standby: " + $Policy.label + "  after " + $ResumeGraceSeconds + "s") }

# If it is already hashing when the guard starts, wrap it now: the table must show it before it ever needs stopping.
if ((Get-MinerRunning) -and (Test-PwUp)) { [void](Sync-StandbyToPw) }

while ($true) {
  $tick++
  if ($tick % 20 -eq 0) {
    $Policy = Get-StandbyPolicy
    if ($Policy -and $null -ne $Policy.after) { $ResumeGraceSeconds = [int]$Policy.after }
  }
  $pinned = Test-Path $PinFile
  if ($Policy -and $null -ne $Policy.pinned) { if ($Policy.pinned) { $pinned = $true } }
  $ai = @(Get-AiWork)
  $miner = Get-MinerRunning

  # Keep the table complete as the miner's own launcher spawns children: unMiner starts one SRBMiner after it comes
  # up, and a child nobody wrapped is exactly the invisible process this is meant to end.
  if ($miner -and ($tick % 2 -eq 0) -and (Test-PwUp)) { [void](Sync-StandbyToPw) }
  $idle = Get-IdleState

  # Work that needs the card: a batch job, or a server with a request in flight on GPU layers. An idle server
  # holding a model is parked, not working - it does not get to stop the miner and it does not get a timer.
  # A RUNNING JOB from the book also counts, before its GPU load shows up: the Scheduler already said the card is
  # taken, and waiting for the load to prove it would let the miner fight a job for a few seconds.
  $preempt = @($ai | Where-Object { $_.gpu -and ($_.busy -ne $false) })
  # A BOOKED job is this node's work even before it is running: a five-second job can start and finish between two
  # polls, and a miner that never yields for it is contention the operator never gets told about.
  $bookBusy = ($null -ne $idle -and ([int]$idle.running -gt 0 -or [int]$idle.queued -gt 0))

  if ($preempt.Count -gt 0 -or $bookBusy) {
    if ($null -eq $busySince) { $busySince = Get-Date }
    $freeSince = $null
    if (-not $pinned -and $miner) {
      Stop-Miner
      Send-Event 'standby.yield' @{ ref = $Ref; ai = (@(Describe-AiWork $preempt) -join ','); bookBusy = $bookBusy; at = (Get-Date).ToString('s') }
    }
  }
  else {
    $busySince = $null
    if ($null -eq $freeSince) { $freeSince = Get-Date }

    # the deadline belongs to the book; this guard only waits for it. With no idle branch (Scheduler not running,
    # or a node that does not have one yet) the guard falls back to its own grace so it cannot stall forever.
    $after = $ResumeGraceSeconds
    if ($null -ne $idle -and $null -ne $idle.after) { $after = [int]$idle.after }
    $deadline = $null
    if ($null -ne $idle -and $idle.resumeAt) {
      try { $deadline = [datetime]::Parse($idle.resumeAt, [System.Globalization.CultureInfo]::InvariantCulture) } catch { $deadline = $null }
    }
    if ($null -eq $deadline) { $deadline = $freeSince.AddSeconds($after) }

    if (-not $miner -and (Get-Date) -ge $deadline) {
      if ($pinned -and -not $idle.pinned) { LogIt "pinned locally - miner left alone" }
      else {
        Start-Miner
        Send-Event 'standby.resume' @{ ref = $Ref; afterS = $after; source = $(if ($null -ne $idle) { 'book' } else { 'guard' }); at = (Get-Date).ToString('s') }
        $freeSince = Get-Date
      }
    }
  }

  # Reported, not computed: the deadline is the book's, so a reader can compare it with node.<ref>.idle and see the
  # same number. A guard that published its own timer would be publishing somebody else's fact.
  $resumeAt = $null
  if ($null -ne $idle -and $idle.resumeAt -and -not $miner -and -not $pinned) { $resumeAt = $idle.resumeAt }
  elseif ($null -eq $idle -and $null -ne $freeSince -and -not $miner -and -not $pinned) {
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
    after      = $(if ($null -ne $idle -and $null -ne $idle.after) { [int]$idle.after } else { $null })
    idleSource = $(if ($null -ne $idle) { 'book' } else { 'guard' })
    verify     = $script:lastVerify
    standby    = $(if ($Policy -and $Policy.label) { [string]$Policy.label } else { $null })
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

  # Sleep to the poll, OR to the book's deadline if that comes first: a 15s tick that starts the miner 14s after
  # the card went free is a countdown showing 0 while nothing happens, which looks broken to the operator.
  $nap = $PollSeconds
  if (-not $miner -and -not $pinned -and $null -ne $idle -and $idle.resumeAt) {
    try {
      $d = [datetime]::Parse([string]$idle.resumeAt, [System.Globalization.CultureInfo]::InvariantCulture)
      $secs = ($d - (Get-Date)).TotalSeconds
      if ($secs -gt 0 -and $secs -lt $nap) { $nap = [int][math]::Ceiling($secs) + 1 }
    }
    catch { }
  }
  # ...and check the book in slices rather than once at the end: a queued job can be over in five seconds, and a
  # miner that only yields every fifteen is contention the operator never learns about.
  $slept = 0
  $slice = [math]::Max(2, [int][math]::Floor($nap / 3))
  while ($slept -lt $nap) {
    $take = [math]::Min($slice, $nap - $slept)
    Start-Sleep -Seconds $take
    $slept += $take
    if ($slept -ge $nap) { break }
    $fast = Get-IdleState
    if ($null -ne $fast -and ([int]$fast.running -gt 0 -or [int]$fast.queued -gt 0)) {
      LogIt "wake  a job is booked - checking the standby"
      break
    }
  }
}
