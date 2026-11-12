# =====================================================================================
#  ensure-electron.ps1 - a node that can show a window should show a window.
#
#  The rule: Electron is SUPPLIED, not hoped for. The headless shelf is for machines that
#  are declared too small to carry a window - not the default for anything that merely
#  lacks the runtime.
#
#    electron present                 -> print it, exit 0
#    node.json declares headless:true -> print nothing, exit 3 (declared, not accidental)
#    otherwise                        -> fetch electron-win.zip from the controller,
#                                        expand into %LOCALAPPDATA%\hermes\node\node_modules,
#                                        verify, print it, exit 0
#    fetch fails                      -> exit 1 with the reason on stdout, caller decides
#
#  Prints exactly one line:  ELECTRON=<path>   (or ELECTRON= plus the reason)
# =====================================================================================
param(
  [string]$Root = 'C:\AI\hydra-local',
  [string]$Controller = $(if ($env:HYDRA_CONTROLLER) { $env:HYDRA_CONTROLLER } else { 'http://192.168.1.123:8140' }),
  [switch]$Force
)
$ErrorActionPreference = 'Stop'
function Emit($path, $why) {
  if ($path) { Write-Output ("ELECTRON=" + $path) }
  else { Write-Output ("ELECTRON="); if ($why) { Write-Output ("WHY=" + $why) } }
}

$localModule = Join-Path $env:LOCALAPPDATA 'hermes\node\node_modules'
$candidates = @(
  (Join-Path $Root 'tools\electron\electron.exe'),
  (Join-Path $localModule 'electron\dist\electron.exe')
)

# A machine that is genuinely small says so in its own node.json, and that declaration wins:
# a small box should not grow a window merely because a runtime happened to land on it.
$nodeJson = Join-Path $Root 'module\Menu\data\node.json'
if ((Test-Path $nodeJson) -and (-not $Force)) {
  try {
    $j = Get-Content $nodeJson -Raw | ConvertFrom-Json
    if ($j.headless -eq $true -or $j.display -eq 'headless') {
      Emit $null ('declared headless in ' + $nodeJson); exit 3
    }
  } catch { }
}

foreach ($c in $candidates) {
  if (-not $Force -and (Test-Path $c)) { Emit $c $null; exit 0 }
}

$zip = Join-Path $env:TEMP 'electron-win.zip'
$url = ($Controller.TrimEnd('/') + '/electron-win.zip')
try {
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest $url -OutFile $zip -UseBasicParsing -TimeoutSec 600
  if (-not (Test-Path $zip)) { throw 'nothing downloaded' }
} catch {
  Emit $null ('could not fetch ' + $url + ' - ' + $_.Exception.Message); exit 1
}

try {
  New-Item -ItemType Directory -Force -Path $localModule | Out-Null
  Expand-Archive -Path $zip -DestinationPath $localModule -Force
} catch {
  Emit $null ('expand failed - ' + $_.Exception.Message); exit 1
} finally {
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
}

$exe = Join-Path $localModule 'electron\dist\electron.exe'
if (Test-Path $exe) { Emit $exe $null; exit 0 }
Emit $null ('expanded but ' + $exe + ' is missing'); exit 1
