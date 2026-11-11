# Prove the whole chain on this node: anonymous fetch from a PUBLIC github, then the real update check.
$ErrorActionPreference = 'Continue'
'== ' + $env:COMPUTERNAME
$git = 'C:\Program Files\Git\cmd\git.exe'
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  foreach ($c in @('C:\AI\hydra-local\tools\node\node.exe')) { if (Test-Path $c) { $node = $c; break } }
}
'  node: ' + $(if ($node) { $node } else { 'MISSING' })
Push-Location 'C:\AI\hydra-local'
'  --- anonymous fetch (no credential anywhere on this box)'
$env:GIT_TERMINAL_PROMPT = '0'
& $git fetch --quiet origin main 2>&1 | ForEach-Object { '    | ' + $_ }
'  origin/main: ' + (& $git log -1 --format='%h %cI %s' origin/main)
'  HEAD       : ' + (& $git log -1 --format='%h %s' 2>$null)
'  --- newest three commits on GitHub:'
& $git log -3 --format='    %h %cI %s' origin/main
Pop-Location
if ($node -and (Test-Path 'C:\AI\hydra-local\scripts\check-update.mjs')) {
  '  --- the update check itself (what the daily job runs):'
  & $node 'C:\AI\hydra-local\scripts\check-update.mjs' 2>&1 | ForEach-Object { '    ' + $_ }
  '  exit code: ' + $LASTEXITCODE
} else { '  (check-update.mjs not on this box yet - it is still uncommitted on 123)' }
'NODE UPDATE PROOF DONE'
