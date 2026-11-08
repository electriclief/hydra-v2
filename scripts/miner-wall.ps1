# =====================================================================================
#  MINER WALL - a share log you can stand in front of.
#
#  The card on this node mines quantus around the clock. Until now the only way to know
#  that was to ask a door on another machine, which is not proof - it is a claim about
#  evidence. This window IS the evidence: every share the pool accepts, as it happens,
#  with the rate at that moment and the running totals. If it stops scrolling, mining
#  has stopped, and that is the whole point.
#
#  It reads two things that already exist and writes nothing:
#    - the miner's own API on 127.0.0.1:60130  (rate, accepted, rejected, uptime)
#    - data\standby\guard.log                 (the guard's share accept/reject lines)
#  Either can be missing and the wall keeps drawing, saying so in place.
#
#  Run: conhost.exe powershell.exe -NoProfile -NoExit -File <this file>
# =====================================================================================
param(
  [int]$PollSeconds = 5,
  [string]$Root = 'C:\AI\hydra-local',
  [string]$ApiBase = 'http://127.0.0.1:60130/',
  [int]$HeartbeatSeconds = 60
)

$ErrorActionPreference = 'Continue'
$piped = $false
try { $piped = [Console]::IsOutputRedirected } catch { }
if (-not $piped) { try { $Host.UI.RawUI.WindowTitle = 'robert - mining (quantus)' } catch { } }

$guardLog = Join-Path $Root 'data\standby\guard.log'
$wall = New-Object System.Collections.Generic.List[string]
$seen = @{}   # share numbers already shown: the log is read by byte offset, and a partial read must never print twice
$state = @{ accepted = $null; rejected = $null; rate = $null; unit = 'MH/s'; uptime = $null; api = 'down'; pool = 'unknown'; since = $null; started = (Get-Date) }

# start at the end of the guard log: the wall is about now, and the header carries the totals that came before
$offset = 0
if (Test-Path $guardLog) { $offset = (Get-Item $guardLog).Length }

# ...but open with the last few shares already on it. A wall that begins as an empty box saying "waiting" is the same
# experience as a blank screen for the person standing in front of it - the history is right there in the log, so show
# it, and let the new lines scroll in underneath.
if ((Test-Path $guardLog) -and $offset -gt 0) {
  $back = [Math]::Min(20000, $offset)
  $fs = [System.IO.File]::Open($guardLog, 'Open', 'Read', 'ReadWrite')
  try {
    [void]$fs.Seek($offset - $back, 'Begin')
    $sr = New-Object System.IO.StreamReader($fs)
    $tail = $sr.ReadToEnd()
    $sr.Dispose()
  } finally { $fs.Dispose() }
  $seed = @()
  foreach ($line in ($tail -split "`r?`n")) {
    if ($line.Length -lt 20) { continue }
    $ts = ([datetime]$line.Substring(0, 19)).ToString('HH:mm:ss')
    if ($line -match 'share accepted (\d+) \(\+(\d+)\)\s+(\S+)\s+([\d.]+)\s+(\S+)\s+pool (\S+)') {
      $seed += ('{0}   ACCEPTED  #{1,-5} +{2}   {3} {4}   {5}' -f $ts, $matches[1], $matches[2], $matches[4], $matches[5], $matches[6])
      $seen['A' + $matches[1]] = 1
    } elseif ($line -match 'SHARE REJECTED (\d+) \(\+(\d+)\)\s+(\S+)\s+pool (\S+)') {
      $seed += ('{0}   REJECTED  #{1,-5} +{2}   {3}   {4}' -f $ts, $matches[1], $matches[2], $matches[3], $matches[4])
      $seen['R' + $matches[1]] = 1
    } elseif ($line -match 'mode -> ai') {
      $seed += ('{0}   YIELD     the card goes to AI work - mining stopped by the guard' -f $ts)
    } elseif ($line -match 'mode -> mining') {
      $seed += ('{0}   RESUME    the card is idle - mining started again through the wrapper' -f $ts)
    } elseif ($line -match 'standby: (.+?)\s+after (\d+)s') {
      $seed += ('{0}   IDLE      {1} - resumes after {2} min idle' -f $ts, $matches[1], [math]::Round([int]$matches[2] / 60))
    }
  }
  $seedCount = [Math]::Min($seed.Count, 30)
  if ($seedCount -gt 0) { $wall.AddRange([string[]]$seed[($seed.Count - $seedCount)..($seed.Count - 1)]) }
}

function Format-Rate([double]$h) {
  # the miner reports raw hashes per second (24.2e12 on this node, 9.02e7 on robert) - a wall that says
  # "24200319608142.8 MH/s" is technically true and useless
  if ($h -ge 1e12) { return @([math]::Round($h / 1e12, 2), 'TH/s') }
  if ($h -ge 1e9) { return @([math]::Round($h / 1e9, 2), 'GH/s') }
  if ($h -ge 1e6) { return @([math]::Round($h / 1e6, 2), 'MH/s') }
  if ($h -ge 1e3) { return @([math]::Round($h / 1e3, 2), 'kH/s') }
  return @([math]::Round($h, 2), 'H/s')
}

function Get-Api {
  try {
    $r = Invoke-RestMethod -Uri $ApiBase -TimeoutSec 4
    $a = @($r.algorithms) | Select-Object -First 1
    if (-not $a) { $state.api = 'down'; return $false }
    $state.api = 'up'
    # SRBMiner's own shape: the live rate is hashrate.'1min' (a quoted key, hence the dots), shares are nested, and the
    # pool is an object whose .pool is the host:port. Reading "hashrate_total_now" here silently returned zero.
    $state.rate = $null
    $f = Format-Rate ([double]$a.hashrate.'1min')
    $state.rate = $f[0]
    $state.unit = $f[1]
    $state.accepted = [int]$a.shares.accepted
    $state.rejected = [int]$a.shares.rejected
    if ($null -ne $r.mining_time) { $state.uptime = [int]$r.mining_time }
    elseif ($a.pool -and $null -ne $a.pool.uptime) { $state.uptime = [int]$a.pool.uptime }
    # robert's build reports neither, so say when the pool session opened rather than print a question mark: an empty
    # field on a proof panel reads as "this bit does not work"
    if ($a.pool -and $a.pool.time_connected) { $state.since = ([string]$a.pool.time_connected) }
    if ($a.pool -and $a.pool.pool) { $state.pool = [string]$a.pool.pool }
    return $true
  } catch {
    $state.api = 'down'
    return $false
  }
}

function Get-NewShares {
  if (-not (Test-Path $guardLog)) { return }
  $len = (Get-Item $guardLog).Length
  if ($len -lt $offset) { $offset = 0 }   # the guard restarted and the log rotated
  if ($len -eq $offset) { return }
  $fs = [System.IO.File]::Open($guardLog, 'Open', 'Read', 'ReadWrite')
  try {
    [void]$fs.Seek($offset, 'Begin')
    $sr = New-Object System.IO.StreamReader($fs)
    $chunk = $sr.ReadToEnd()
    $offset = $len
    $sr.Dispose()
  } finally { $fs.Dispose() }
  foreach ($line in ($chunk -split "`r?`n")) {
    if ($line.Length -lt 20) { continue }
    $ts = ([datetime]$line.Substring(0, 19)).ToString('HH:mm:ss')
    if ($line -match 'share accepted (\d+) \(\+(\d+)\)\s+(\S+)\s+([\d.]+)\s+(\S+)\s+pool (\S+)') {
      $key = 'A' + $matches[1]
      if ($seen.ContainsKey($key)) { continue }
      $seen[$key] = 1
      $wall.Add(('{0}   ACCEPTED  #{1,-5} +{2}   {3} {4}   {5}' -f (Get-Date).ToString('HH:mm:ss'), $matches[1], $matches[2], $matches[4], $matches[5], $matches[6]))
      if ($piped) { Write-Output ('{0}  ACCEPTED  #{1,-5} +{2}   {3} {4}   {5}' -f (Get-Date).ToString('HH:mm:ss'), $matches[1], $matches[2], $matches[4], $matches[5], $matches[6]) }
    } elseif ($line -match 'SHARE REJECTED (\d+) \(\+(\d+)\)\s+(\S+)\s+pool (\S+)') {
      $key = 'R' + $matches[1]
      if ($seen.ContainsKey($key)) { continue }
      $seen[$key] = 1
      $wall.Add(('{0}   REJECTED  #{1,-5} +{2}   {3}   {4}' -f $ts, $matches[1], $matches[2], $matches[3], $matches[4]))
      if ($piped) { Write-Output ('{0}  REJECTED  #{1,-5} +{2}   {3}   {4}' -f $ts, $matches[1], $matches[2], $matches[3], $matches[4]) }
    } elseif ($line -match 'mode -> ai') {
      # the miner stops when real work wants the card. That is the integration being true, and it must be readable here:
      # a wall that only shows shares makes a deliberate yield look identical to a crash.
      $wall.Add(('{0}   YIELD     the card goes to AI work - mining stopped by the guard' -f $ts))
      if ($piped) { Write-Output ('{0}  YIELD     the card goes to AI work - mining stopped by the guard' -f $ts) }
    } elseif ($line -match 'mode -> mining') {
      $wall.Add(('{0}   RESUME    the card is idle - mining started again through the wrapper' -f $ts))
      if ($piped) { Write-Output ('{0}  RESUME    the card is idle - mining started again through the wrapper' -f $ts) }
    } elseif ($line -match 'standby: (.+?)\s+after (\d+)s') {
      $mins = [math]::Round([int]$matches[2] / 60)
      $wall.Add(('{0}   IDLE      {1} - resumes after {2} min idle' -f $ts, $matches[1], $mins))
      if ($piped) { Write-Output ('{0}  IDLE      {1} - resumes after {2} min idle' -f $ts, $matches[1], $mins) }
    }
  }
  while ($wall.Count -gt 400) { $wall.RemoveAt(0) }
}

function Draw {
  $now = Get-Date
  $up = if ($state.uptime) { '{0}h {1:00}m' -f [int]($state.uptime / 3600), [int](($state.uptime % 3600) / 60) } elseif ($state.since) { 'since ' + $state.since.Substring([Math]::Max(0, $state.since.Length - 5)) } else { '-' }
  $acc = if ($null -ne $state.accepted) { $state.accepted } else { '?' }
  $rej = if ($null -ne $state.rejected) { $state.rejected } else { '?' }
  $rate = if ($null -ne $state.rate) { '{0} {1}' -f $state.rate, $state.unit } else { '?' }

  Clear-Host
  $bar = '=' * 78
  Write-Host $bar -ForegroundColor DarkCyan
  Write-Host '  ROBERT  -  MINING QUANTUS                    proof, not a claim' -ForegroundColor Cyan
  Write-Host $bar -ForegroundColor DarkCyan
  Write-Host ('  card      RX 590 8 GB (ellesmere)      pool  ' + $state.pool) -ForegroundColor Gray
  Write-Host ('  rate      ' + $rate.PadRight(24) + 'uptime   ' + $up) -ForegroundColor Gray
  Write-Host ('  accepted  ' + ([string]$acc).PadRight(24) + 'rejected ' + [string]$rej) -ForegroundColor Gray
  if ($state.api -eq 'down') { Write-Host '  miner api  DOWN - the card is not answering on :60130' -ForegroundColor Red }
  Write-Host $bar -ForegroundColor DarkCyan
  Write-Host '  time        event      #      delta   rate        pool' -ForegroundColor DarkGray

  $rows = [Math]::Max(6, $Host.UI.RawUI.WindowSize.Height - 12)
  $start = [Math]::Max(0, $wall.Count - $rows)
  for ($i = $start; $i -lt $wall.Count; $i++) {
    $l = $wall[$i]
    if ($l -match 'YIELD') { Write-Host ('  ' + $l) -ForegroundColor Yellow }
    elseif ($l -match 'REJECTED') { Write-Host ('  ' + $l) -ForegroundColor Red }
    elseif ($l -match 'RESUME|IDLE') { Write-Host ('  ' + $l) -ForegroundColor Cyan }
    else { Write-Host ('  ' + $l) -ForegroundColor Green }
  }
  if ($wall.Count -eq 0) { Write-Host '  waiting for the next share...' -ForegroundColor DarkGray }

  Write-Host $bar -ForegroundColor DarkCyan
  Write-Host ('  ' + $now.ToString('HH:mm:ss') + '   watching :60130 and the guard log   ' + $(if ($state.rate) { 'card is hashing' } else { 'NO READING FROM THE CARD' }) + '   next line within ' + $PollSeconds + 's') -ForegroundColor DarkCyan
}

Get-Api | Out-Null
if ($piped) {
  Write-Output ('{0}  MINER WALL  {1}   rate {2} {3}   accepted {4}   rejected {5}{6}' -f (Get-Date).ToString('HH:mm:ss'), $state.pool, $state.rate, $state.unit, $state.accepted, $state.rejected, $(if ($state.api -eq 'down') { '   API DOWN' } else { '' }))
} else {
  Draw
}

$lastBeat = Get-Date
while ($true) {
  Start-Sleep -Seconds $PollSeconds
  $ok = Get-Api
  Get-NewShares
  if ($piped) {
    if ((((Get-Date) - $lastBeat).TotalSeconds) -ge $HeartbeatSeconds) {
      $lastBeat = Get-Date
      $up = if ($state.uptime) { '{0}h {1:00}m' -f [int]($state.uptime / 3600), [int](($state.uptime % 3600) / 60) } elseif ($state.since) { 'since ' + $state.since.Substring([Math]::Max(0, $state.since.Length - 5)) } else { '-' }
      Write-Output ('{0}  alive     {1} {2}   accepted {3}   rejected {4}   up {5}{6}' -f (Get-Date).ToString('HH:mm:ss'), $state.rate, $state.unit, $state.accepted, $state.rejected, $up, $(if ($state.api -eq 'down') { '   API DOWN - the card is not answering on :60130' } else { '' }))
    }
  } else {
    Draw
  }
  if (-not $ok) { Start-Sleep -Seconds 5 }
}
