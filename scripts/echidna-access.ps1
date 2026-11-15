# EchidnaAccess - the local privilege broker.
#
# Transport is a raw TcpListener speaking just enough HTTP/1.1. HttpListener was the obvious choice and the wrong one:
# it goes through http.sys, so a wildcard prefix needs a URL reservation (netsh http add urlacl, administrator only),
# and an unelevated process cannot bind at all ("Access is denied" from Start()). A plain socket has no such rule, so
# this agent runs identically elevated (SYSTEM) or as a normal user - which is what makes it testable and installable.
#
#   GET  /health                      -> liveness, host, identity, auth mode, jobs, last command   (no token)
#   GET  /audit?limit=20              -> the audit trail (who asked, what ran, what it returned)
#   POST /exec {cmd, cwd?, timeoutSec?}
#   POST /stop                        -> stop and leave a STOP marker so a repeat-task healer respects it
#
# Auth is OPTIONAL BY DESIGN: if token.txt exists the agent demands it in x-access-token; if it does not exist the agent
# is open. Open is the operator's default - a command line in, console out, no questions. The gates that remain are
# allow.json (client addresses) and the firewall rule the installer writes.
param(
  [int]$Port = 8142,
  [string]$Bind = '0.0.0.0',
  [string]$Data = 'C:\ProgramData\EchidnaAccess',
  [int]$DefaultTimeoutSec = 120
)

$ErrorActionPreference = 'Continue'
$dir = $Data
$tokenFile = Join-Path $dir 'token.txt'
$auditFile = Join-Path $dir 'audit.jsonl'
$stopFile = Join-Path $dir 'STOP'
$allowFile = Join-Path $dir 'allow.json'
$startedAt = Get-Date
$who = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

New-Item -ItemType Directory -Force -Path $dir | Out-Null

# A stopped agent must stay stopped: the install task repeats every minute to heal a crash, so the STOP file is what
# tells it to stay down. Removing the file (or reinstalling) brings it back.
if (Test-Path $stopFile) {
  Write-Output ('echidna-access: STOP file present (' + $stopFile + ') - staying down')
  exit 0
}

$token = ''
if (Test-Path $tokenFile) { $token = (Get-Content $tokenFile -Raw).Trim() }
$authMode = 'open'
if ($token) { $authMode = 'token' }

# A duplicate instance is a no-op (the healer fires this every minute while the agent is healthy).
#
# But "something is listening" is NOT "an agent is serving": a hung instance holds the socket and never answers a
# request, and a TCP connect to it succeeds perfectly. That is a CORPSE, and this box shipped with exactly that - after a
# reboot the port was bound, every request timed out, and every healer run saw "already serving" and left the corpse in
# place. So the check asks for /health and reads the answer; only a real answer means "leave it alone".
$servedBy = $null
try {
  $probe = Invoke-WebRequest -Uri ('http://127.0.0.1:' + $Port + '/health') -UseBasicParsing -TimeoutSec 2
  if ($probe.StatusCode -eq 200) { $servedBy = 'health' }
} catch { }
if ($servedBy) {
  Write-Output ('echidna-access: port ' + $Port + ' is already served by another instance - leaving it alone')
  exit 0
}

# The port may still be BOUND by a corpse (or by something that is not us). Clear it, but only if it is another copy of
# this script: killing a stranger's listener by port alone is how a node loses a service nobody meant to touch.
$stale = @()
try { $stale = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique) } catch { }
foreach ($sid in $stale) {
  $proc = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $sid) -ErrorAction SilentlyContinue
  if ($proc -and $proc.CommandLine -and $proc.CommandLine -match 'EchidnaAccess\.ps1') {
    try {
      Stop-Process -Id $sid -Force -ErrorAction Stop
      Write-Output ('echidna-access: replaced a stale instance on port ' + $Port + ' (pid ' + $sid + ', alive but not answering)')
    } catch {
      Write-Output ('echidna-access: port ' + $Port + ' is held by a stale instance (pid ' + $sid + ') that could not be stopped: ' + $_.Exception.Message)
    }
    Start-Sleep -Milliseconds 800
  } elseif ($proc) {
    Write-Output ('echidna-access: port ' + $Port + ' is held by ' + $proc.Name + ' (pid ' + $sid + ') which is not this agent - refusing to touch it')
  }
}

$ip = [System.Net.IPAddress]::Any
if ($Bind -eq '127.0.0.1' -or $Bind -eq 'localhost') { $ip = [System.Net.IPAddress]::Loopback }
elseif ($Bind -ne '0.0.0.0' -and $Bind -ne '+') { try { $ip = [System.Net.IPAddress]::Parse($Bind) } catch { } }

$listener = $null
try {
  $listener = New-Object System.Net.Sockets.TcpListener($ip, $Port)
  $listener.Start(50)
} catch {
  Write-Output ('echidna-access: cannot listen on ' + $Bind + ':' + $Port + ' - ' + $_.Exception.Message)
  exit 3
}
Write-Output ('echidna-access: listening on ' + $Bind + ':' + $Port + ' as ' + $who + ' (auth: ' + $authMode + ')')

function Clip-Text([string]$s, [int]$n) {
  if ($null -eq $s) { return '' }
  if ($s.Length -le $n) { return $s }
  return $s.Substring(0, $n)
}

function Write-Audit($record) {
  try {
    if (Test-Path $auditFile) {
      if ((Get-Item $auditFile).Length -gt 8MB) { Move-Item $auditFile (Join-Path $dir 'audit.1.jsonl') -Force }
    }
    $line = ($record | ConvertTo-Json -Compress -Depth 4)
    [System.IO.File]::AppendAllText($auditFile, $line + "`n", (New-Object System.Text.UTF8Encoding($false)))
  } catch { }
}

function Get-AllowList() {
  if (-not (Test-Path $allowFile)) { return @() }
  try {
    $a = Get-Content $allowFile -Raw | ConvertFrom-Json
    if ($null -eq $a.clients) { return @() }
    return @($a.clients | ForEach-Object { [string]$_ })
  } catch { return @() }
}

# One command, its own process, a hard timeout, both pipes drained concurrently so a chatty child cannot deadlock.
function Invoke-CommandLine([string]$cmd, [string]$cwd, [int]$timeoutSec) {
  $enc = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes(('$ProgressPreference=''SilentlyContinue'';' + $cmd)))
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $psi.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ' + $enc
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  if ($cwd -and (Test-Path -LiteralPath $cwd)) { $psi.WorkingDirectory = $cwd } else { $psi.WorkingDirectory = $env:SystemRoot }

  $t0 = Get-Date
  $proc = [System.Diagnostics.Process]::Start($psi)
  $outTask = $proc.StandardOutput.ReadToEndAsync()
  $errTask = $proc.StandardError.ReadToEndAsync()
  $killed = $false
  if (-not $proc.WaitForExit($timeoutSec * 1000)) {
    $killed = $true
    try { & "$env:SystemRoot\System32\taskkill.exe" /PID $proc.Id /T /F 2>$null | Out-Null } catch { }
    try { $proc.WaitForExit(5000) | Out-Null } catch { }
  }
  $stdout = ''
  $stderr = ''
  try { $stdout = $outTask.GetAwaiter().GetResult() } catch { }
  try { $stderr = $errTask.GetAwaiter().GetResult() } catch { }
  $code = -1
  try { $code = [int]$proc.ExitCode } catch { }
  if ($killed) { $code = 124 }
  return @{
    exitCode = $code
    stdout   = $stdout
    stderr   = $stderr
    ms       = [long]((Get-Date) - $t0).TotalMilliseconds
    killed   = $killed
  }
}

function Send-Response($stream, [int]$code, [string]$json) {
  $reason = 'OK'
  if ($code -eq 400) { $reason = 'Bad Request' }
  elseif ($code -eq 401) { $reason = 'Unauthorized' }
  elseif ($code -eq 403) { $reason = 'Forbidden' }
  elseif ($code -eq 404) { $reason = 'Not Found' }
  elseif ($code -eq 500) { $reason = 'Internal Server Error' }
  elseif ($code -eq 503) { $reason = 'Service Unavailable' }
  $head = "HTTP/1.1 $code $reason`r`nContent-Type: application/json; charset=utf-8`r`nCache-Control: no-store`r`nConnection: close`r`n"
  $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $head = $head + 'Content-Length: ' + $bodyBytes.Length + "`r`n`r`n"
  try {
    $headBytes = [System.Text.Encoding]::ASCII.GetBytes($head)
    $stream.Write($headBytes, 0, $headBytes.Length)
    $stream.Write($bodyBytes, 0, $bodyBytes.Length)
    $stream.Flush()
  } catch { }
}

function Read-Request($stream) {
  $buf = New-Object byte[] 8192
  $mem = New-Object System.IO.MemoryStream
  $headerText = ''
  $headerEnd = -1
  while ($true) {
    $n = $stream.Read($buf, 0, $buf.Length)
    if ($n -le 0) { break }
    $mem.Write($buf, 0, $n)
    $all = [System.Text.Encoding]::UTF8.GetString($mem.ToArray())
    $idx = $all.IndexOf("`r`n`r`n")
    if ($idx -ge 0) { $headerEnd = $idx; $headerText = $all.Substring(0, $idx); break }
    if ($mem.Length -gt 65536) { break }
  }
  if ($headerEnd -lt 0) { return $null }

  $lines = $headerText -split "`r`n"
  $parts = $lines[0] -split ' '
  if ($parts.Length -lt 2) { return $null }
  $headers = @{}
  for ($i = 1; $i -lt $lines.Length; $i++) {
    $c = $lines[$i].IndexOf(':')
    if ($c -gt 0) { $headers[$lines[$i].Substring(0, $c).Trim().ToLower()] = $lines[$i].Substring($c + 1).Trim() }
  }
  $contentLength = 0
  if ($headers.ContainsKey('content-length')) { try { $contentLength = [int]$headers['content-length'] } catch { } }

  $allBytes = $mem.ToArray()
  $bodyStart = $headerEnd + 4
  $have = $allBytes.Length - $bodyStart
  while ($have -lt $contentLength) {
    $n = $stream.Read($buf, 0, [Math]::Min($buf.Length, $contentLength - $have))
    if ($n -le 0) { break }
    $mem.Write($buf, 0, $n)
    $allBytes = $mem.ToArray()
    $have = $allBytes.Length - $bodyStart
  }
  $body = ''
  if ($contentLength -gt 0 -and $allBytes.Length -ge $bodyStart) {
    $body = [System.Text.Encoding]::UTF8.GetString($allBytes, $bodyStart, [Math]::Min($contentLength, $allBytes.Length - $bodyStart))
  }
  return @{
    method  = $parts[0].ToUpper()
    target  = $parts[1]
    headers = $headers
    body    = $body
  }
}

$jobs = 0
$last = $null
$running = $true

while ($running) {
  $client = $null
  try { $client = $listener.AcceptTcpClient() } catch { break }
  $stream = $null
  try {
    $stream = $client.GetStream()
    $stream.ReadTimeout = 15000
    $req = Read-Request $stream
    if ($null -eq $req) { continue }

    $remote = ''
    try { $remote = $client.Client.RemoteEndPoint.Address.ToString() } catch { }
    $target = $req.target
    $path = $target
    $query = ''
    $qi = $target.IndexOf('?')
    if ($qi -ge 0) { $path = $target.Substring(0, $qi); $query = $target.Substring($qi + 1) }
    $qs = @{}
    foreach ($pair in ($query -split '&')) {
      if (-not $pair) { continue }
      $kv = $pair -split '=', 2
      if ($kv.Length -eq 2) { $qs[$kv[0]] = [System.Uri]::UnescapeDataString($kv[1]) }
      else { $qs[$kv[0]] = '' }
    }

    if (Test-Path $stopFile) {
      Write-Audit @{ at = (Get-Date).ToString('o'); ip = $remote; path = $path; refused = 'STOP file present' }
      Send-Response $stream 503 ('{"ok":false,"error":"agent stopped by the STOP file","stopFile":"' + ($stopFile -replace '\\', '\\') + '"}')
      continue
    }

    if ($path -eq '/health' -and $req.method -eq 'GET') {
      $payload = @{
        ok      = $true
        agent   = 'echidna-access'
        host    = $env:COMPUTERNAME
        user    = $who
        port    = $Port
        bind    = $Bind
        auth    = $authMode
        since   = $startedAt.ToString('o')
        uptimeH = [math]::Round(((Get-Date) - $startedAt).TotalHours, 2)
        jobs    = $jobs
        last    = $last
      } | ConvertTo-Json -Depth 4 -Compress
      Send-Response $stream 200 $payload
      continue
    }

    $allow = Get-AllowList
    # Loopback is always allowed: a process on this same machine already has this privilege, so refusing 127.0.0.1
    # protects nothing and breaks every local caller (the Access door calls itself this way).
    $isLoopback = ($remote -eq '127.0.0.1') -or ($remote -eq '::1')
    if ($allow.Count -gt 0 -and (-not $isLoopback) -and ($allow -notcontains $remote)) {
      Write-Audit @{ at = (Get-Date).ToString('o'); ip = $remote; path = $path; refused = 'client not in allow.json' }
      Send-Response $stream 403 ('{"ok":false,"error":"client ' + $remote + ' is not in allow.json"}')
      continue
    }

    $given = [string]$req.headers['x-access-token']
    if (-not $given -and $qs.ContainsKey('token')) { $given = [string]$qs['token'] }
    if ($token -and $given -ne $token) {
      Write-Audit @{ at = (Get-Date).ToString('o'); ip = $remote; path = $path; refused = 'bad token' }
      Send-Response $stream 401 '{"ok":false,"error":"x-access-token is missing or wrong"}'
      continue
    }

    if ($path -eq '/audit' -and $req.method -eq 'GET') {
      $limit = 20
      if ($qs.ContainsKey('limit')) { try { $limit = [int]$qs['limit'] } catch { } }
      $rows = @()
      if (Test-Path $auditFile) {
        $rows = @(Get-Content $auditFile -Tail $limit | ForEach-Object { try { $_ | ConvertFrom-Json } catch { } })
      }
      Send-Response $stream 200 ((@{ ok = $true; count = $rows.Count; rows = $rows } | ConvertTo-Json -Depth 5 -Compress))
      continue
    }

    if ($path -eq '/stop' -and $req.method -eq 'POST') {
      Write-Audit @{ at = (Get-Date).ToString('o'); ip = $remote; path = $path; event = 'stop requested' }
      try { [System.IO.File]::WriteAllText($stopFile, ('stopped at ' + (Get-Date).ToString('o')), (New-Object System.Text.UTF8Encoding($false))) } catch { }
      Send-Response $stream 200 ('{"ok":true,"stopping":true,"resume":"del ' + ($stopFile -replace '\\', '\\') + '"}')
      $running = $false
      continue
    }

    if ($path -eq '/exec' -and $req.method -eq 'POST') {
      $body = $null
      try { $body = $req.body | ConvertFrom-Json } catch { }
      if ($null -eq $body) { Send-Response $stream 400 '{"ok":false,"error":"body must be JSON: {\"cmd\":\"...\"}"}'; continue }
      $cmd = [string]$body.cmd
      if (-not $cmd) { Send-Response $stream 400 '{"ok":false,"error":"cmd is required"}'; continue }
      $cwd = ''
      if ($body.cwd) { $cwd = [string]$body.cwd }
      $timeout = $DefaultTimeoutSec
      if ($body.timeoutSec) { $timeout = [int]$body.timeoutSec }
      if ($timeout -gt 1800) { $timeout = 1800 }

      $result = Invoke-CommandLine $cmd $cwd $timeout
      $jobs = $jobs + 1
      $last = @{ at = (Get-Date).ToString('o'); exitCode = $result.exitCode; ms = $result.ms; cmd = (Clip-Text $cmd 120) }
      Write-Audit @{
        at = (Get-Date).ToString('o'); ip = $remote; cmd = (Clip-Text $cmd 2000); cwd = $cwd; timeoutSec = $timeout
        exitCode = $result.exitCode; ms = $result.ms; killed = $result.killed
        outBytes = $result.stdout.Length; errBytes = $result.stderr.Length
        host = $env:COMPUTERNAME; user = $who
      }
      $payload = @{
        ok = $true; host = $env:COMPUTERNAME; user = $who
        exitCode = $result.exitCode; stdout = $result.stdout; stderr = $result.stderr
        ms = $result.ms; killed = $result.killed
      } | ConvertTo-Json -Depth 4 -Compress
      Send-Response $stream 200 $payload
      continue
    }

    Send-Response $stream 404 '{"ok":false,"error":"no such route","paths":["/health","/audit","/exec","/stop"]}'
  } catch {
    try { Write-Audit @{ at = (Get-Date).ToString('o'); error = $_.Exception.Message } } catch { }
  } finally {
    try { if ($stream) { $stream.Close() } } catch { }
    try { if ($client) { $client.Close() } } catch { }
  }
}

try { $listener.Stop() } catch { }
Write-Output 'echidna-access: stopped'
