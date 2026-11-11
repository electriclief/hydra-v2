# Bring this node's Echidna up to the build that can be read back (GET /api/monitor), and make sure the door is running
# as a ProcessWrapper row. Written as a file because inline PowerShell over ssh keeps eating the quotes.
$ErrorActionPreference = 'Continue'
$root = 'C:\AI\hydra-local'
$ech = Join-Path $root 'module\Echidna'

'host: ' + $env:COMPUTERNAME
'  server.js has GET /api/monitor: ' + (Select-String -Path (Join-Path $ech 'public\js\server.js') -Pattern 'method === "GET"' -Quiet)
'  before: ' + $(try { (Invoke-RestMethod 'http://127.0.0.1:8138/api/monitor' -TimeoutSec 4).monitor.card.title } catch { 'no answer' })

# which node binary to run with: a node this install ships with beats whatever happens to be on the box,
# because a system node older than the module's engine requirement fails with a bare "exit code 1".
$nodePath = ''
if (Test-Path (Join-Path $root 'tools\node\node.exe')) { $nodePath = Join-Path $root 'tools\node\node.exe' }
if (-not $nodePath) {
  $p = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ExecutablePath } | Select-Object -First 1)
  if ($p.Count) { $nodePath = [string]$p[0].ExecutablePath }
}
$cmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodePath -and $cmd) { $nodePath = $cmd.Source }
'  node: ' + $nodePath + '  (' + (& $nodePath -v) + ')'

# stop whatever echidna row is running, then raise a fresh one with the same invocation the app uses
try {
  @((Invoke-RestMethod 'http://127.0.0.1:8125/api/processes' -TimeoutSec 6).processes) | Where-Object { $_.name -like 'echidna*' -and $_.life -eq 'running' } | ForEach-Object {
    Invoke-RestMethod -Method Post -Uri ('http://127.0.0.1:8125/api/processes/' + $_.id + '/kill') -Body '{"force":true}' -ContentType 'application/json' -TimeoutSec 12 | Out-Null
    '  killed ' + $_.id
  }
} catch { '  pw kill failed: ' + $_.Exception.Message }
Start-Sleep -Seconds 3
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $nodePath } | ForEach-Object {
  $cl = (Get-CimInstance Win32_Process -Filter ("ProcessId=" + $_.Id)).CommandLine
  if ($cl -match 'Echidna') { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue; '  stopped stray echidna pid ' + $_.Id }
}

$body = @{
  name = 'echidna-8138'; tag = 'door'; isolation = 'in-loop'
  command = $nodePath
  args = @('public/js/main.js', '--port', '8138', '--host', '0.0.0.0')
  cwd = $ech
} | ConvertTo-Json -Depth 4
try {
  $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8125/api/processes' -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 20
  '  raised ' + $r.process.id + ' life ' + $r.process.life
} catch { '  raise failed: ' + $_.Exception.Message }

Start-Sleep -Seconds 7
'  after: ' + $(try { $c = (Invoke-RestMethod 'http://127.0.0.1:8138/api/monitor' -TimeoutSec 6).monitor.card; if ($c) { '[' + $c.kind + '] ' + $c.title } else { 'empty board' } } catch { 'no answer' })
'ECHIDNA REFRESH DONE'
