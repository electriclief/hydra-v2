# echidna-access-install.ps1 - one elevated run per node, and never again.
#
#   iwr http://192.168.1.123:8140/echidna-access-install.ps1 -UseBasicParsing | iex
#
# Verbose by default: every step is numbered, timed and tagged PASS / WARN / FAIL, and the whole transcript is POSTed
# back to the controller at the end (success or failure), so nobody has to retype a console.
#
# Flags (all optional):
#   -Controller 192.168.1.123:8140   where the agent is downloaded from
#   -Port 8142                       the agent's port
#   -Bind 0.0.0.0 | 127.0.0.1        who can reach it (default 0.0.0.0 so the controller can call it)
#   -Clients 192.168.1.123           comma-separated allowlist; the firewall is limited to these too
#   -Secured                         require a token (created if missing, or -Token <hex> to fix it). Default is OPEN.
#   -NoTask                          install files only (for a manual start)
#   -NoPost                          do not send the transcript to the controller
#
param(
  [string]$Controller = '192.168.1.123:8140',
  [int]$Port = 8142,
  [string]$Bind = '0.0.0.0',
  [string]$Clients = '192.168.1.123',
  [string]$Token = '',
  [switch]$Secured,
  [switch]$NoTask,
  [switch]$NoPost
)

$ErrorActionPreference = 'Stop'
$dir = 'C:\ProgramData\EchidnaAccess'
$agent = Join-Path $dir 'EchidnaAccess.ps1'
$tokenFile = Join-Path $dir 'token.txt'
$allowFile = Join-Path $dir 'allow.json'
$taskName = 'EchidnaAccess'

$t0 = Get-Date
$step = 0
$log = New-Object System.Collections.Generic.List[string]
$fails = 0

function Say([string]$tag, [string]$name, [string]$detail) {
  $script:step = $script:step + 1
  $secs = [math]::Round(((Get-Date) - $script:t0).TotalSeconds, 1)
  $line = '[{0,2}] {1,-4} {2,-14} {3}   ({4}s)' -f $script:step, $tag, $name, $detail, $secs
  Write-Output $line
  $script:log.Add($line)
  if ($tag -eq 'FAIL') { $script:fails = $script:fails + 1 }
}
function Note([string]$name, [string]$detail) { Say 'INFO' $name $detail }

function Get-MyIp {
  try { return (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.IPAddress -like '192.168.*' } | Select-Object -First 1).IPAddress } catch { return '?' }
}

# The transcript goes home. This is the piece that stops "it didn't work" from being an unanswered question: the
# installer reports its own outcome, including the failures, without anybody copying a console.
function Post-Report([string]$verdict) {
  if ($NoPost) { Note 'report' 'not posted (-NoPost)'; return }
  $header = '=== echidna-access install ===' + "`n" + 'host: ' + $env:COMPUTERNAME + ' (' + (Get-MyIp) + ')   when: ' + (Get-Date -Format 'o') + "`n"
  $body = $header + ($script:log -join "`n") + "`n`nVERDICT: " + $verdict + "`n"
  try {
    $r = Invoke-WebRequest -Uri ('http://' + $Controller + '/post') -Method POST -Body $body -ContentType 'text/plain; charset=utf-8' -UseBasicParsing -TimeoutSec 10
    $j = $r.Content | ConvertFrom-Json
    Write-Output ('posted the transcript to 123 as inbox/' + $j.file)
  } catch {
    Write-Output ('could not post the transcript: ' + $_.Exception.Message)
  }
}

$who = [System.Security.Principal.WindowsIdentity]::GetCurrent()
Note 'host' ($env:COMPUTERNAME + ' (' + (Get-MyIp) + ')')
Note 'identity' ($who.Name + ' / powershell ' + $PSVersionTable.PSVersion.ToString())
Note 'controller' $Controller

$isAdmin = $false
try { $isAdmin = (New-Object System.Security.Principal.WindowsPrincipal($who)).IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator) } catch { }
if (-not $isAdmin) {
  # One line, one UAC click. Re-launch this same script elevated instead of telling the operator to go and find an
  # Administrator shell - that hunt is exactly the middle-man step this app exists to delete.
  Say 'WARN' 'elevated' 'not elevated - re-launching myself elevated (approve the UAC prompt)'
  $self = Join-Path $env:TEMP 'echidna-access-install.ps1'
  try {
    $src = (Invoke-WebRequest -Uri ('http://' + $Controller + '/echidna-access-install.ps1') -UseBasicParsing -TimeoutSec 30).Content
    if ($src -is [byte[]]) { $src = [System.Text.Encoding]::UTF8.GetString($src) }
    [System.IO.File]::WriteAllText($self, $src, (New-Object System.Text.UTF8Encoding($false)))
    $argList = '-NoProfile -ExecutionPolicy Bypass -File "' + $self + '" -Controller ' + $Controller + ' -Port ' + $Port + ' -Bind ' + $Bind
    if ($Clients) { $argList = $argList + ' -Clients ' + $Clients }
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argList | Out-Null
    Write-Output ''
    Write-Output 'A UAC prompt is open. Approve it and the install finishes in the elevated window; the transcript'
    Write-Output 'is posted to 123 either way, so nothing has to be copied back here.'
    Post-Report 'NOT ELEVATED - re-launched itself through UAC'
    return
  } catch {
    Say 'FAIL' 'elevated' ('NO - and self-elevation failed: ' + $_.Exception.Message)
    Write-Output ''
    Write-Output 'VERDICT: NOT ELEVATED - open PowerShell as Administrator and run the same line again.'
    Post-Report 'NOT ELEVATED - self-elevation failed: ' + $_.Exception.Message
    return
  }
}
Say 'PASS' 'elevated' 'high integrity'

New-Item -ItemType Directory -Force -Path $dir | Out-Null
# The token is the only thing between the LAN and SYSTEM; the folder is SYSTEM + Administrators, nothing else.
& icacls.exe $dir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
Say 'PASS' 'folder' ($dir + ' (SYSTEM + Administrators only)')

# OPEN BY DEFAULT: the operator asked for a command line in and console out, no questions. A token is created only when
# -Secured (or -Token) is passed, and a stray token.txt from an earlier run is removed so a reinstall really is open.
if ($Secured -or $Token) {
  if ((-not (Test-Path $tokenFile)) -or $Token) {
    if (-not $Token) {
      $bytes = New-Object byte[] 24
      $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
      $rng.GetBytes($bytes)
      $Token = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
    }
    [System.IO.File]::WriteAllText($tokenFile, $Token, (New-Object System.Text.UTF8Encoding($false)))
    Say 'PASS' 'token' 'generated (24 bytes, written to token.txt)'
  } else {
    Say 'PASS' 'token' 'kept the existing one'
  }
  & icacls.exe $tokenFile /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
} else {
  if (Test-Path $tokenFile) {
    Remove-Item $tokenFile -Force -ErrorAction SilentlyContinue
    Say 'PASS' 'token' 'OPEN mode - removed the old token.txt (-Secured recreates one)'
  } else {
    Say 'PASS' 'token' 'OPEN mode - no token, no questions'
  }
}

$url = 'http://' + $Controller + '/echidna-access.ps1'
$sw = [System.Diagnostics.Stopwatch]::StartNew()
try {
  $body = (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30).Content
  if ($body -is [byte[]]) { $body = [System.Text.Encoding]::UTF8.GetString($body) }
} catch {
  Say 'FAIL' 'download' ($url + ' - ' + $_.Exception.Message)
  Write-Output ''
  Write-Output 'VERDICT: CANNOT DOWNLOAD - this box cannot fetch the agent from the controller.'
  Post-Report 'CANNOT DOWNLOAD the agent from ' + $url
  return
}
if (-not ($body -match 'EchidnaAccess')) {
  Say 'FAIL' 'download' 'the response is not the agent (wrong controller, or a page instead of a script)'
  Write-Output ''
  Write-Output 'VERDICT: WRONG DOWNLOAD - the controller answered, but not with the agent.'
  Post-Report 'WRONG DOWNLOAD - the content did not contain the agent marker'
  return
}
[System.IO.File]::WriteAllText($agent, $body, (New-Object System.Text.UTF8Encoding($false)))
Say 'PASS' 'download' ($url + ' -> ' + (Get-Item $agent).Length + ' bytes in ' + $sw.ElapsedMilliseconds + ' ms')

$clientList = @()
if ($Clients) { $clientList = @($Clients.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }
$allow = @{ clients = $clientList } | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText($allowFile, $allow, (New-Object System.Text.UTF8Encoding($false)))
Say 'PASS' 'allow.json' ($allow)

if ($Bind -ne '127.0.0.1') {
  # No URL reservation: the agent listens on a raw socket, not through http.sys, so there is no http.sys ACL to add.
  Note 'urlacl' 'not needed - the agent uses a raw socket, not http.sys'
  # The firewall is the first gate: only the declared controllers may open the port at all.
  $existing = Get-NetFirewallRule -DisplayName ('EchidnaAccess ' + $Port) -ErrorAction SilentlyContinue
  if ($existing) { Remove-NetFirewallRule -DisplayName ('EchidnaAccess ' + $Port) -ErrorAction SilentlyContinue }
  $params = @{
    DisplayName = 'EchidnaAccess ' + $Port; Direction = 'Inbound'; Protocol = 'TCP'
    LocalPort = $Port; Action = 'Allow'; Profile = 'Any'
  }
  if ($clientList.Count -gt 0) { $params.RemoteAddress = $clientList }
  try {
    New-NetFirewallRule @params | Out-Null
    Say 'PASS' 'firewall' ('allow tcp ' + $Port + ' from ' + ($clientList -join ','))
  } catch {
    Say 'WARN' 'firewall' ('could not create the rule: ' + $_.Exception.Message)
  }
} else {
  Note 'firewall' 'not needed - bound to 127.0.0.1 only'
}

if ($NoTask) {
  Say 'WARN' 'task' 'skipped (-NoTask)'
  Write-Output ''
  Write-Output ('VERDICT: FILES ONLY - start it by hand: powershell -File "' + $agent + '" -Port ' + $Port + ' -Bind ' + $Bind)
  Post-Report 'FILES ONLY (-NoTask)'
  return
}

# A scheduled task rather than a service: no SCM handshake to satisfy, it survives a reboot, and it is visible and
# removable by name. The agent is the thing that never needs a human again.
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $agent + '" -Port ' + $Port + ' -Bind ' + $Bind)
# ONE trigger, repeated every minute, starting in the past: this is both the boot behaviour (StartWhenAvailable runs it
# as soon as the scheduler is up) and the self-healer (a killed agent is back within a minute). A boot trigger with a
# repetition attached was measured NOT to heal - the task stayed dead for 150 s - because the repetition hangs off a
# start boundary the boot trigger does not have. MultipleInstances=IgnoreNew plus the agent's own port check make the
# minute a no-op while it is healthy.
$trigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(-1)) `
  -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
try {
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($trigger) -Principal $principal -Settings $settings -Force | Out-Null
  $t = Get-ScheduledTask -TaskName $taskName
  Say 'PASS' 'task' ('registered: state ' + $t.State + ', runs as ' + $t.Principal.UserId + '/' + $t.Principal.RunLevel + ', every minute')
} catch {
  Say 'FAIL' 'task' ('registration failed: ' + $_.Exception.Message)
  Write-Output ''
  Write-Output 'VERDICT: TASK NOT REGISTERED - the agent files exist but will never start by themselves.'
  Post-Report 'TASK NOT REGISTERED - ' + $_.Exception.Message
  return
}

# A reinstall means "make it work": clear a deliberate stop so the agent comes up.
if (Test-Path (Join-Path $dir 'STOP')) { Remove-Item (Join-Path $dir 'STOP') -Force -ErrorAction SilentlyContinue; Note 'stop file' 'cleared' }

$stale = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like ('*' + $agent + '*') }
$killed = 0
foreach ($p in $stale) { try { Stop-Process -Id $p.ProcessId -Force; $killed = $killed + 1 } catch { } }
if ($killed -gt 0) { Start-Sleep -Milliseconds 500; Note 'restart' ('stopped ' + $killed + ' old agent process(es)') }
Start-ScheduledTask -TaskName $taskName

# 120 s, not 30: measured on ReX (A8-6500, two cores) - the firewall step took 63 s and the agent bound 50 s after the
# task started, so a 30 s window reported FAIL on a box that was working a minute later. A slow machine is not a broken
# machine, and a false FAIL costs the operator a round trip.
$deadline = (Get-Date).AddSeconds(120)
$h = $null
$up = $false
$waited = 0
while ((Get-Date) -lt $deadline) {
  try {
    $h = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $Port + '/health') -TimeoutSec 3
    if ($h.ok) { $up = $true; break }
  } catch { }
  Start-Sleep -Milliseconds 900
  $waited = $waited + 1
  if (($waited % 10) -eq 0) { Note 'waiting' ('agent not answering yet, ' + [math]::Round(((Get-Date) - $t0).TotalSeconds, 0) + 's in (on a slow box this is normal)') }
}

if ($up) {
  Say 'PASS' 'health' ('ok - ' + $h.host + ', ' + $h.user + ', port ' + $h.port + ', up ' + $h.uptimeH + ' h')
  $info = $null
  try { $info = Get-ScheduledTaskInfo -TaskName $taskName } catch { }
  if ($info) { Note 'task info' ('last run ' + $info.LastRunTime.ToString('HH:mm:ss') + ', result 0x' + ('{0:X}' -f $info.LastTaskResult)) }
  Write-Output ''
  Write-Output ('VERDICT: WORKING - EchidnaAccess is live on ' + $env:COMPUTERNAME + ' at http://' + $Bind + ':' + $Port + '/')
  # OPEN mode deliberately leaves no token.txt; reading it unconditionally printed a red "cannot find path" error
  # AFTER the success verdict, which reads as a broken install. Say which mode it is instead.
  if (Test-Path $tokenFile) {
    Write-Output ('token: ' + (Get-Content $tokenFile -Raw).Trim())
  } else {
    Write-Output 'token: none (OPEN mode - only the controller may connect, enforced by firewall)'
  }
  Post-Report 'WORKING - agent live as ' + $h.user + ' on port ' + $Port
} else {
  Say 'FAIL' 'health' ('http://127.0.0.1:' + $Port + '/health did not answer within 120 s')
  $info = $null
  try { $info = Get-ScheduledTaskInfo -TaskName $taskName } catch { }
  if ($info) { Note 'task info' ('last run ' + $info.LastRunTime.ToString('HH:mm:ss') + ', result 0x' + ('{0:X}' -f $info.LastTaskResult)) }
  $tail = ''
  try { $tail = (Get-Content (Join-Path $dir 'audit.jsonl') -Tail 3) -join ' | ' } catch { }
  if ($tail) { Note 'audit tail' $tail }
  Write-Output ''
  Write-Output 'VERDICT: TASK RAN BUT THE AGENT IS DOWN - run it by hand to see the console error:'
  Write-Output ('  powershell -NoProfile -ExecutionPolicy Bypass -File "' + $agent + '" -Port ' + $Port + ' -Bind ' + $Bind)
  Post-Report 'TASK RAN, AGENT DOWN - /health did not answer in 30 s'
}
