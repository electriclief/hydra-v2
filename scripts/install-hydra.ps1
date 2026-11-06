<#
  install-hydra.ps1 - turn a Windows box into a Hydra V2 node, from GitHub.

  This is install-from-zero: clone the shelf, write the one file that makes this box a node (node.json),
  install each door's dependencies, build the compiled js, and run every gate. It does not start anything;
  starting is a separate, visible act (see INSTALL.md).

  The repo is PRIVATE. Authenticate first, once, on the node:
      gh auth login        (or set a read-only PAT and use https://<token>@github.com/... )

  Example:
      .\install-hydra.ps1 -Ref 149 -Name "149 - shop pc"
      .\install-hydra.ps1 -Ref lab -Dest D:\hydra -SkipGates      # throwaway node, no gates
#>
param(
  [Parameter(Mandatory = $true)][string]$Ref,
  [string]$Name = '',
  [string]$Dest = 'C:\AI\hydra-local',
  [string]$Repo = 'https://github.com/electriclief/hydra-v2.git',
  [switch]$SkipDeps,
  [switch]$SkipGates
)

$ErrorActionPreference = 'Stop'

function Say($m) { Write-Host ("[install] " + $m) }
function Die($m) { Write-Host ("[install] REFUSED: " + $m) -ForegroundColor Red; exit 1 }

# ---- preconditions ---------------------------------------------------------------------------------------
$git = (Get-Command git -ErrorAction SilentlyContinue)
if (-not $git) { Die 'git is not on PATH. Install Git for Windows first.' }
$node = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $node) { Die 'node is not on PATH. Node 22+ is required (the doors are ESM).' }

$nodeVersion = (& node --version).TrimStart('v')
if ([int]($nodeVersion.Split('.')[0]) -lt 22) { Die ("node " + $nodeVersion + " is too old; 22+ is required.") }

if (Test-Path $Dest) {
  $entries = Get-ChildItem -LiteralPath $Dest -Force -ErrorAction SilentlyContinue
  if ($entries) { Die ("destination " + $Dest + " already exists and is not empty. Use update-hydra.ps1 for an existing node.") }
}

$Ref = $Ref.Trim().ToLower()
if ($Ref -notmatch '^[a-z0-9][a-z0-9-]{0,23}$') { Die 'ref must be lowercase letters, digits or hyphen (max 24).' }

# ---- clone -----------------------------------------------------------------------------------------------
Say ("cloning " + $Repo + " -> " + $Dest)
& git clone --depth 1 $Repo $Dest
if ($LASTEXITCODE -ne 0) {
  Die 'clone failed. A private repo needs credentials on this node: run "gh auth login" once, then retry.'
}

# ---- the instance layer: what makes this box THIS node ---------------------------------------------------
$dataDir = Join-Path $Dest 'module\Menu\data'
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$nodeFile = Join-Path $dataDir 'node.json'
if (Test-Path $nodeFile) {
  # a clone of another node's identity is worse than none: say it out loud instead of silently keeping it
  $existing = (Get-Content $nodeFile -Raw | ConvertFrom-Json)
  Say ("WARNING: node.json already exists (ref " + $existing.ref + '). Keeping it. Delete it and rerun to write ref ' + $Ref + '.')
}
else {
  $nodeJson = [ordered]@{
    ref        = $Ref
    name       = $(if ($Name) { $Name } else { $Ref })
    gpu        = 'unknown - fill this in'
    note       = 'The instance layer. Paths live here, never in a service file, so the same service can run on another node unchanged.'
    modelsDirs = @{}
  }
  ($nodeJson | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath $nodeFile -Encoding utf8
  Say ("wrote " + $nodeFile + "  (ref " + $Ref + ")")
}

foreach ($d in @('data\standby', '.shelf', 'logs')) {
  New-Item -ItemType Directory -Force -Path (Join-Path $Dest $d) | Out-Null
}

# ---- dependencies, build, gates --------------------------------------------------------------------------
$modules = Get-ChildItem -Path (Join-Path $Dest 'module') -Directory | Where-Object {
  Test-Path (Join-Path $_.FullName 'package.json')
}

if (-not $SkipDeps) {
  foreach ($m in $modules) {
    Say ("npm install  " + $m.Name)
    Push-Location $m.FullName
    try {
      & npm install --no-audit --no-fund --loglevel=error
      if ($LASTEXITCODE -ne 0) { Die ("npm install failed in " + $m.Name) }
    }
    finally { Pop-Location }
  }
}

foreach ($m in $modules) {
  $pkg = Get-Content (Join-Path $m.FullName 'package.json') -Raw | ConvertFrom-Json
  if (-not ($pkg.scripts -and $pkg.scripts.build)) { continue }
  if (-not (Test-Path (Join-Path $m.FullName 'node_modules'))) {
    Say ("build skipped: " + $m.Name + " has no node_modules (run without -SkipDeps)")
    continue
  }
  Say ("build        " + $m.Name)
  Push-Location $m.FullName
  try {
    & npm run --silent build 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { Say ("build failed: " + $m.Name + " (continuing - compiled js ships in the repo)") }
  }
  finally { Pop-Location }
}

if (-not $SkipGates) {
  $failed = @()
  foreach ($m in $modules) {
    $pkg = Get-Content (Join-Path $m.FullName 'package.json') -Raw | ConvertFrom-Json
    if ($pkg.scripts -and $pkg.scripts.selftest) {
      Push-Location $m.FullName
      try {
        $out = & npm run --silent selftest 2>&1 | Out-String
        $ok = ($LASTEXITCODE -eq 0)
        Say (("{0,-22} {1}" -f $m.Name, $(if ($ok) { 'GREEN' } else { 'RED' })))
        if (-not $ok) { $failed += $m.Name; Write-Host $out.Trim() }
      }
      finally { Pop-Location }
    }
  }
  if ($failed.Count -gt 0) { Say ("gates red on: " + ($failed -join ', ') + " - the node will start, but it is not clean.") }
}

Say 'done. Nothing was started.'
Write-Host ''
Write-Host "  next:   cd $Dest\module\Basic_App"
Write-Host "          node electron/main.cjs          # the shell: raises doors, guard and tabs"
Write-Host "  help:   http://127.0.0.1:8199           # every door explains itself"
Write-Host "  status: curl http://127.0.0.1:8132/api/statusline"
Write-Host ''
Write-Host "  Hydra V2 does not work as a product. Expect breakage; the README says so."
