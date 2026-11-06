<#
  update-hydra.ps1 - bring this node up to the shelf published on GitHub.

  The node pulls; nothing is pushed into it. This script is the visible form of that: it fetches, reports how
  far behind it is, refuses when the tree is dirty (a pull that overwrites local work is a deletion nobody asked
  for), then moves with a fast-forward only. It never merges and never rebases - a node either fast-forwards or
  stays where it is and says why.

  Example:
      .\update-hydra.ps1 -DryRun        # how far behind, and what changed
      .\update-hydra.ps1                # pull, rebuild what changed, run the gates
      .\update-hydra.ps1 -Restart       # ...and restart the shell so the node runs the new code
#>
param(
  [string]$Path = 'C:\AI\hydra-local',
  [switch]$DryRun,
  [switch]$Restart,
  [switch]$SkipGates
)

$ErrorActionPreference = 'Stop'

function Say($m) { Write-Host ("[update] " + $m) }
function Die($m) { Write-Host ("[update] REFUSED: " + $m) -ForegroundColor Red; exit 1 }

if (-not (Test-Path (Join-Path $Path '.git'))) { Die ($Path + ' is not a git checkout. Run install-hydra.ps1 for a fresh node.') }
Push-Location $Path
try {
  # ---- where are we, and is the tree safe to move? -------------------------------------------------------
  $branch = (& git rev-parse --abbrev-ref HEAD).Trim()
  if ($branch -ne 'main') { Die ("on branch " + $branch + ', not main. This node only fast-forwards main.') }

  $dirty = (& git status --porcelain)
  if ($dirty) {
    Say 'the tree has local changes; refusing to pull over them:'
    $dirty | Select-Object -First 12 | ForEach-Object { Write-Host ('    ' + $_) }
    Die 'commit or discard them, then run again. A pull that hides local work is the thing this refuses.'
  }

  Say 'fetching origin'
  & git fetch --prune origin 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Die 'fetch failed - is this node authenticated to the repo? (gh auth login, or a token remote)' }

  $behind = [int]((& git rev-list --count 'HEAD..origin/main')).Trim()
  $ahead = [int]((& git rev-list --count 'origin/main..HEAD')).Trim()
  $localRev = (& git rev-parse --short HEAD).Trim()
  $remoteRev = (& git rev-parse --short origin/main).Trim()

  Say ("local " + $localRev + "  remote " + $remoteRev + "  behind " + $behind + "  ahead " + $ahead)
  if ($ahead -gt 0) {
    Say 'this node has commits origin does not - it will NOT be overwritten. Sort that out by hand.'
  }
  if ($behind -eq 0) {
    Say 'up to date. Nothing to do.'
    exit 0
  }

  # ---- what would change --------------------------------------------------------------------------------
  $changed = @(& git diff --name-only "HEAD..origin/main")
  Say ($changed.Count.ToString() + ' files differ:')
  $byArea = $changed | ForEach-Object { if ($_ -match '^module/([^/]+)/') { $Matches[1] } elseif ($_ -match '^([^/]+)/') { $Matches[1] } else { '(root)' } } |
    Group-Object | Sort-Object Count -Descending
  $byArea | Select-Object -First 10 | ForEach-Object { Write-Host ("    {0,-18} {1}" -f $_.Name, $_.Count) }

  if ($DryRun) {
    Say 'dry run - nothing was changed.'
    exit 0
  }

  # ---- move ---------------------------------------------------------------------------------------------
  Say 'fast-forwarding'
  & git merge --ff-only origin/main 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Die 'fast-forward failed; the node stays on its current revision.' }

  # rebuild only where the build inputs moved, but reinstall when a lockfile did
  $areas = $changed | ForEach-Object { if ($_ -match '^module/([^/]+)/') { $Matches[1] } } | Sort-Object -Unique
  $lockChanged = $changed | Where-Object { $_ -match 'package-lock\.json$' }

  foreach ($area in $areas) {
    $dir = Join-Path $Path ('module\' + $area)
    if (-not (Test-Path (Join-Path $dir 'package.json'))) { continue }
    if ($lockChanged | Where-Object { $_ -like ("module/" + $area + "/*") }) {
      Say ("npm install  " + $area + " (lockfile changed)")
      Push-Location $dir; & npm install --no-audit --no-fund --loglevel=error | Out-Null; Pop-Location
    }
    $pkg = Get-Content (Join-Path $dir 'package.json') -Raw | ConvertFrom-Json
    if ($pkg.scripts -and $pkg.scripts.build) {
      Say ("build        " + $area)
      Push-Location $dir
      & npm run --silent build 2>&1 | Out-Null
      if ($LASTEXITCODE -ne 0) { Say ("build failed: " + $area) }
      Pop-Location
    }
  }

  if (-not $SkipGates) {
    $failed = @()
    foreach ($area in $areas) {
      $dir = Join-Path $Path ('module\' + $area)
      if (-not (Test-Path (Join-Path $dir 'package.json'))) { continue }
      $pkg = Get-Content (Join-Path $dir 'package.json') -Raw | ConvertFrom-Json
      if (-not ($pkg.scripts -and $pkg.scripts.selftest)) { continue }
      Push-Location $dir
      & npm run --silent selftest 2>&1 | Out-Null
      if ($LASTEXITCODE -ne 0) { $failed += $area }
      Pop-Location
    }
    if ($failed.Count -gt 0) { Say ("gates RED on: " + ($failed -join ', ')) } else { Say 'gates green on every touched module' }
  }

  # ---- report, in the node's own words -------------------------------------------------------------------
  $newRev = (& git rev-parse --short HEAD).Trim()
  $remoteUrl = (& git remote get-url origin).Trim()
  $report = [ordered]@{
    at         = (Get-Date).ToString('s')
    from       = $localRev
    to         = $newRev
    behind     = $behind
    files      = $changed.Count
    source     = $remoteUrl
    byModule   = $byArea | ForEach-Object { @{ module = $_.Name; files = $_.Count } }
  }
  $reportDir = Join-Path $Path '.shelf'
  New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
  ($report | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath (Join-Path $reportDir 'git-update.json') -Encoding utf8
  Say ("now at " + $newRev + " (report: .shelf\git-update.json)")

  if ($Restart) {
    # the shell is an ELECTRON app, not a node script: node electron/main.cjs would fail to open a window
    $electron = $env:HYDRA_ELECTRON
    if (-not $electron) {
      foreach ($candidate in @(
        (Join-Path $env:LOCALAPPDATA 'hermes\node\node_modules\electron\dist\electron.exe'),
        (Join-Path $Path 'node_modules\electron\dist\electron.exe'),
        (Join-Path $Path 'module\Basic_App\node_modules\electron\dist\electron.exe')
      )) { if (Test-Path $candidate) { $electron = $candidate; break } }
    }
    if (-not $electron) { Die 'no electron.exe found; set $env:HYDRA_ELECTRON to its path, or restart the shell yourself.' }

    Say ('restarting the shell: ' + $electron)
    Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 3
    Start-Process -FilePath $electron -ArgumentList 'electron/main.cjs' -WorkingDirectory (Join-Path $Path 'module\Basic_App')
    Say 'shell relaunched (doors and guard come back with it)'
  }
  else {
    Say 'files are in place; the RUNNING doors still serve the old js. Re-run with -Restart, or restart the shell yourself.'
  }
}
finally { Pop-Location }
