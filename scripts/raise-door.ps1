# =====================================================================================
#  RAISE-DOOR - put a module's door in the ProcessWrapper table, bound for the LAN.
#
#  Doors default to 127.0.0.1. That is right for a page on the same box and wrong for a fleet: the Mirror on 123, the
#  Menu on any node, and this operator's ssh all read doors over the LAN. A row raised without --host 0.0.0.0 listens
#  to itself and looks healthy from inside - the exact shape of "it works on that machine".
# =====================================================================================
param(
  [Parameter(Mandatory = $true)][string]$Name,      # e.g. services-8128
  [Parameter(Mandatory = $true)][string]$Module,    # e.g. Services
  [Parameter(Mandatory = $true)][int]$Port,
  # Doors that are pages (Menu, Services, TrainOfThought) serve from public\js\main.js. The ones that ARE the
  # server - Mirror, Core, State - start from src\main.js, and a raiser that cannot say so silently raises the
  # browser bundle on a port, which answers nothing: "bound to nothing".
  [string]$Entry = ''
)
$ErrorActionPreference = 'Continue'
$root = 'C:\AI\hydra-local'
$mainJs = if ($Entry) { Join-Path $root $Entry } else { Join-Path $root "module\$Module\public\js\main.js" }
if (-not (Test-Path $mainJs)) { "entry not found: $mainJs - nothing raised"; exit 1 }
"door $Name on $Port  ($mainJs)"

$conns = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($procId in $conns) {
  if ($procId -and $procId -ne 0) {
    $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
    "  stopping $procId $($p.ProcessName)"
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  }
}
Start-Sleep -Seconds 3

$nodeExe = @('C:\Program Files\nodejs\node.exe', (Join-Path $env:LOCALAPPDATA 'hermes\node\node.exe')) | Where-Object { Test-Path $_ } | Select-Object -First 1
$body = @{
  name    = $Name
  command = $nodeExe
  args    = @($mainJs, '--host', '0.0.0.0')
  cwd     = (Join-Path $root "module\$Module")
  tag     = 'door'
} | ConvertTo-Json -Depth 4
try {
  $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8125/api/processes' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 20
  "  raised $($r.process.id) pid $($r.process.pid)"
} catch {
  "  the wrapper refused: $($_.Exception.Message)"
  exit 1
}

for ($i = 0; $i -lt 15; $i++) {
  Start-Sleep -Seconds 2
  try {
    $h = Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 3
    if ($h.ok) { "  health ok after $((($i + 1) * 2))s"; break }
  } catch { }
}
$bind = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
"  bound to " + $(if ($bind) { $bind.LocalAddress } else { 'nothing' })
