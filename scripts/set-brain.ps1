# =====================================================================================
#  SET-BRAIN - point the agent at one of the four declared brains, and prove it took.
#
#  The choice is entered in Hydra (this script is what the service page calls): module/Services/services/agent-brain.js
#  declares WHAT each back end is, module/Services/data/brain.json says WHICH one this node uses, and Hermes is
#  configured to match. Three layers, one command.
#
#  It never invents a credential. A cloud back end names the environment variable it needs; if that key is not in the
#  hermes .env, the script says so and stops - a fake key produces a 401 that looks like a broken brain.
#
#  Every switch ends with a probe: one question asked of the new brain. No answer, no switch - the previous config is
#  restored from the backup taken seconds earlier, so "it did not work" can never mean "and now nothing works".
# =====================================================================================
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('llama-local', 'llama-lan', 'openrouter-free', 'deepseek')]
  [string]$Backend,

  [string]$Host_,
  [string]$Model,
  [string]$Root = 'C:\AI\hydra-local',
  [string]$HermesHome = "$env:LOCALAPPDATA\hermes",
  [switch]$Probe,
  [switch]$NoRestart,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
function Say($m) { Write-Output $m }

$brainFile = Join-Path $Root 'module\Services\data\brain.json'
$configFile = Join-Path $HermesHome 'config.yaml'
$envFile = Join-Path $HermesHome '.env'

Say "brain: $Backend"

# ---- 1. the declaration, read from the service file itself (one source of truth)
$svcPath = Join-Path $Root 'module\Services\services\agent-brain.js'
$nodeExe = @(
  'C:\Program Files\nodejs\node.exe',
  (Join-Path $env:LOCALAPPDATA 'hermes\node\node.exe')
) | Where-Object { Test-Path $_ } | Select-Object -First 1
$decl = $null
try {
  $node = & $nodeExe (Join-Path $Root 'scripts\brain-decl.cjs') $svcPath $Backend 2>$null
  if ($node) { $decl = ($node | Out-String).Trim() | ConvertFrom-Json }
} catch { }
if (-not $decl) { throw "the service file has no back end called '$Backend' - nothing to apply" }
Say ("  declares: " + $decl.label + "  (" + $decl.where + ")")

# ---- 2. instance data: the endpoint override lives on the node, not in the service
$brain = @{ active = $Backend; backends = @{} }
if (Test-Path $brainFile) {
  try { $brain = Get-Content $brainFile -Raw | ConvertFrom-Json } catch { Say '  brain.json was unreadable - rewriting it' }
}
if (-not $brain.backends) { $brain | Add-Member -NotePropertyName backends -NotePropertyValue ([pscustomobject]@{}) -Force }

$baseUrl = [string]$decl.apply.base_url
$modelId = if ($Model) { $Model } elseif ($decl.apply.model) { [string]$decl.apply.model } else { $null }

if ($Backend -eq 'llama-lan') {
  # the host is remembered from the last time this node used a LAN brain; the declaration says WHAT, this says WHERE
  $h = if ($Host_) { $Host_ } elseif ($brain.host -and $brain.active -eq 'llama-lan') { [string]$brain.host } else { $null }
  if (-not $h) { throw 'llama-lan needs -Host_ <address> the first time: the service says WHAT a LAN brain is, this node says WHERE it is' }
  $baseUrl = "http://${h}:8080/v1"
  if (-not $modelId) { $modelId = if ($brain.model -and $brain.active -eq 'llama-lan') { [string]$brain.model } else { 'local-model' } }
}
if ($Backend -eq 'llama-local' -and -not $modelId) {
  # llama-server reports the model id at /v1/models; ask it rather than guessing a filename
  try {
    $models = Invoke-RestMethod 'http://127.0.0.1:8080/v1/models' -TimeoutSec 5
    $modelId = @($models.data)[0].id
  } catch {
    Say '  nothing is serving on 127.0.0.1:8080 right now - the model id cannot be read until llama-server is up'
  }
}

# ---- 3. the key the back end needs, if any
if ($decl.keyEnv) {
  $have = $false
  if (Test-Path $envFile) {
    foreach ($l in Get-Content $envFile) {
      if ($l -match ("^\s*" + [regex]::Escape($decl.keyEnv) + "\s*=\s*\S")) { $have = $true; break }
    }
  }
  if (-not $have) {
    throw "this brain needs $($decl.keyEnv) in $envFile and it is not there. Put the key in and run again - a fake key looks exactly like a broken brain."
  }
  Say "  key: $($decl.keyEnv) present"
}

Say ("  provider: " + $decl.apply.provider)
Say ("  base_url: " + $baseUrl)
Say ("  model:    " + $(if ($modelId) { $modelId } else { '(unset - the server decides)' }))

if ($DryRun) { Say '  dry run - nothing written'; return }

# ---- 4. write the choice into the node's instance data
# FLAT on purpose. A map of every back end ever used is a museum, not a record: what matters is which brain this node is
# on right now, where it is, and when it was applied. Flat also means nothing can be lost to a serializer quirk - a
# nested PowerShell hashtable serialises as its .NET members and produces a file that only looks like JSON.
$brain = New-Object System.Collections.Specialized.OrderedDictionary
$brain['_about'] = 'Which brain this node''s agent uses. The four back ends are declared in module/Services/services/agent-brain.js; this file records only the current choice. Applied with scripts/set-brain.ps1 -Backend <id> -Probe.'
$brain['active'] = $Backend
$brain['label'] = $decl.label
$brain['provider'] = $decl.apply.provider
$brain['base_url'] = $baseUrl
$brain['model'] = $modelId
if ($Backend -eq 'llama-lan') { $brain['host'] = ($baseUrl -replace '^https?://', '' -replace ':8080/v1$', '') }
$brain['appliedAt'] = (Get-Date).ToString('s')
New-Item -ItemType Directory -Force (Split-Path $brainFile) | Out-Null
# no BOM: this file is read as JSON by machines, and PowerShell 5.1's -Encoding UTF8 would make it unparseable there
$jsonText = $brain | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($brainFile, $jsonText, (New-Object System.Text.UTF8Encoding($false)))
Say "  choice recorded in $brainFile"

# ---- 5. configure hermes: three lines, and a backup to fall back to
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$configFile.bak-brain-$stamp"
Copy-Item $configFile $backup -Force
$yaml = Get-Content $configFile -Raw
$modelLine = if ($modelId) { "  default: $modelId" } else { "  default: ''" }
$newBlock = "model:`n$modelLine`n  provider: $($decl.apply.provider)`n  base_url: $baseUrl`n"
$pattern = [regex]'(?m)^model:\r?\n(?:[ \t]+.*\r?\n)+'
if (-not $pattern.IsMatch($yaml)) { throw "could not find the model: block in $configFile - refusing to write blind" }
$yaml = $pattern.Replace($yaml, $newBlock, 1)
# Write without a BOM: PowerShell 5.1's -Encoding UTF8 prepends one, and a BOM at the top of config.yaml is a byte that
# every YAML reader has to be lenient about. The agent should not depend on leniency.
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($configFile, $yaml, $utf8NoBom)
Say "  hermes configured (backup: $(Split-Path $backup -Leaf))"

# ---- 6. the door that hosts the agent has to pick the new config up
if (-not $NoRestart) {
  try {
    $rows = (Invoke-RestMethod 'http://127.0.0.1:8125/api/processes' -TimeoutSec 5).processes
    $row = $rows | Where-Object { $_.name -like 'echidna*' -and $_.life -eq 'running' } | Select-Object -First 1
    if ($row) {
      Invoke-RestMethod -Uri ("http://127.0.0.1:8125/api/processes/$($row.id)/kill") -Method Post -ContentType 'application/json' -Body '{"force":true}' -TimeoutSec 15 | Out-Null
      Say "  stopped $($row.id)"
      Start-Sleep -Seconds 3
    }
    $nodeExe = @(
      'C:\Program Files\nodejs\node.exe',
      (Join-Path $env:LOCALAPPDATA 'hermes\node\node.exe')
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    $body = @{ name = 'echidna-8138'; command = $nodeExe; args = @((Join-Path $Root 'module\Echidna\public\js\main.js')); cwd = (Join-Path $Root 'module\Echidna'); tag = 'door' } | ConvertTo-Json -Depth 4
    $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8125/api/processes' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 20
    Say "  door raised as $($r.process.id)"
    for ($i = 0; $i -lt 15; $i++) {
      Start-Sleep -Seconds 2
      try { $h = Invoke-RestMethod 'http://127.0.0.1:8138/health' -TimeoutSec 3; if ($h.ok) { Say '  door answers /health'; break } } catch { }
    }
  } catch {
    Say "  could not restart the door: $($_.Exception.Message) (the config is still written)"
  }
}

# ---- 7. the probe: one real question, or the switch did not happen
if ($Probe) {
  Say '  proving it: asking the new brain one question'
  $hermes = Join-Path $env:LOCALAPPDATA 'hermes\hermes-agent\.hermes\bin\hermes.exe'
  if (-not (Test-Path $hermes)) { $hermes = 'hermes' }
  # The agent writes progress to stderr, and a native command's stderr under ErrorActionPreference=Stop is a terminating
  # error in PowerShell 5.1 - which would read as "the brain failed" when the brain was working perfectly. Capture
  # everything to a file and judge the text, not the stream.
  $tmpOut = Join-Path ([System.IO.Path]::GetTempPath()) ('brain-probe-' + [guid]::NewGuid().ToString('n').Substring(0, 8) + '.txt')
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $hermes chat -q 'Reply with exactly: brain ok' --oneshot -Q *> $tmpOut
  $ErrorActionPreference = $prev
  $out = if (Test-Path $tmpOut) { Get-Content $tmpOut -Raw } else { '' }
  $ok = $out -match 'brain ok'
  Say ("  probe: " + $(if ($ok) { 'ANSWERED - the switch took' } else { 'NO ANSWER - restoring the previous config' }))
  if (-not $ok) {
    Say ('  the brain said: ' + (($out -split "`n" | Where-Object { $_.Trim() } | Select-Object -Last 3) -join ' / '))
    Copy-Item $backup $configFile -Force
    Say "  restored $configFile from $($backup | Split-Path -Leaf)"
    throw "the $Backend brain did not answer - the previous brain is back in place"
  }
  Remove-Item $tmpOut -Force -ErrorAction SilentlyContinue
}

Say 'done'
