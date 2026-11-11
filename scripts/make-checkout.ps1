# Make this box's Hydra a GIT CHECKOUT instead of a tarball copy, without replacing one file of code.
#
# The situation it has to handle: this node was installed from a tarball, so it has files but no history. And 123 - the
# box every tarball came from - is three commits AHEAD of origin/main, with 261 files uncommitted. So `git reset --hard
# origin/main` here would not "update" anything; it would silently roll this node back to 2026-11-08 and lose work that
# only exists on 123. That is a decision for the operator, not a side effect of installing a version control tool.
#
# So: create the checkout, point it at origin, fetch the history, and align HEAD with origin/main -- but leave the
# working tree exactly as it is. git status then answers the only question that matters: which files here differ from
# the fleet's published code. Nothing is overwritten until someone chooses to.
$ErrorActionPreference = 'Continue'
$root = 'C:\AI\hydra-local'
$remote = 'https://github.com/electriclief/hydra-v2.git'
function Section($t) { '' ; '=== ' + $t }

$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
$git = (Get-Command git -ErrorAction SilentlyContinue).Source
if (-not $git) {
  $cand = @('C:\Program Files\Git\cmd\git.exe','C:\Program Files\Git\bin\git.exe') | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($cand) { $git = $cand }
}
if (-not $git) { '  no git on this box yet - run install-git.ps1 first'; 'CLONE SETUP FAILED'; exit 1 }

Section 'git'
'  {0}  ({1})' -f (& $git --version), $git

Section 'the node identity that must survive'
$nodeJson = Join-Path $root 'module\Menu\data\node.json'
$ref = if (Test-Path $nodeJson) { (Get-Content $nodeJson -Raw | ConvertFrom-Json).ref } else { $null }
'  ref: ' + $(if ($ref) { $ref } else { '(none declared)' })

Section 'make it a checkout (idempotent)'
Push-Location $root
if (Test-Path (Join-Path $root '.git')) {
  '  .git already here'
} else {
  & $git init -b main --quiet 2>&1 | ForEach-Object { '  | ' + $_ }
  '  initialised'
}
$hasOrigin = (& $git remote) -contains 'origin'
if (-not $hasOrigin) { & $git remote add origin $remote; '  origin added' } else { '  origin already set' }
'  origin: ' + (& $git remote get-url origin)

Section 'fetch the fleet history (no working tree changes)'
& $git fetch --quiet origin main 2>&1 | ForEach-Object { '  | ' + $_ }
$remoteSha = (& $git rev-parse origin/main 2>$null)
$remoteShort = (& $git log -1 --format='%h %cI %s' origin/main 2>$null)
'  origin/main: ' + $remoteShort

Section 'point HEAD at origin/main WITHOUT touching a single file'
& $git update-ref refs/heads/main $remoteSha 2>&1 | ForEach-Object { '  | ' + $_ }
& $git symbolic-ref HEAD refs/heads/main
& $git branch --set-upstream-to=origin/main main 2>&1 | ForEach-Object { '  | ' + $_ }
& $git reset --mixed --quiet 2>&1 | ForEach-Object { '  | ' + $_ }
'  HEAD now: ' + (& $git log -1 --format='%h %s' 2>$null)

Section 'so what differs from the fleet code?'
$dirty = @(& $git status --porcelain 2>$null)
'  differing files: ' + $dirty.Count
$dirty | Select-Object -First 12 | ForEach-Object { '    ' + $_.Trim() }
Pop-Location

Section 'reality check: is the app still whole?'
'  module folders : ' + @(Get-ChildItem (Join-Path $root 'module') -Directory -ErrorAction SilentlyContinue).Count
'  node.json ref  : ' + $(if (Test-Path $nodeJson) { (Get-Content $nodeJson -Raw | ConvertFrom-Json).ref } else { 'GONE' })
try { $s = Invoke-RestMethod 'http://127.0.0.1:8128/api/services' -TimeoutSec 8; '  services       : ' + @($s.services).Count } catch { '  services       : door down' }
'CLONE SETUP DONE'
