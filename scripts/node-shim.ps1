# node-shim.ps1 - a voice for a machine that does not run Hydra.
#
# Richard, miner1 and Daedalus are ssh-monitored: no modules, no state door, so on a screen they can only be guessed at.
# This is the smallest thing that fixes that honestly - a wrapped process that measures the box and posts a few facts
# into the controller's State. It is NOT a node: it publishes node.<ref>.shim, never a node.<ref>.id, and it never
# claims a service or a door it does not have.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File node-shim.ps1 -Ref richard -MinerApi http://127.0.0.1:60130/
#   powershell ... -Once        one reading, then exit (what a test should look like)
#
# Nothing here is hidden: run it in a window, or under a scheduled task with the console visible.

param(
  [Parameter(Mandatory = $true)][string]$Ref,
  [string]$Controller = 'http://192.168.1.123:8127',
  [string]$MinerApi = '',
  [int]$IntervalSec = 60,
  [switch]$Once
)

$ErrorActionPreference = 'SilentlyContinue'

function nowIso { (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ') }

function gpus {
  # AdapterRAM is a 32-bit field and reports 4095 MB for every card over 4 GB; the registry has the truth.
  $out = @()
  foreach ($vc in (Get-CimInstance Win32_VideoController)) {
    $mb = $null
    try {
      $key = Get-ChildItem 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}' |
        Where-Object { $_.PSChildName -match '^\d{4}$' }
      foreach ($k in $key) {
        $p = Get-ItemProperty $k.PSPath
        if ($p.DriverDesc -eq $vc.Name -and $p.'HardwareInformation.qwMemorySize') {
          $mb = [math]::Round([int64]$p.'HardwareInformation.qwMemorySize' / 1MB); break
        }
      }
    } catch { }
    $out += [ordered]@{ name = $vc.Name; vramMb = $mb; driver = $vc.DriverVersion }
  }
  return $out
}

function disks {
  $out = @()
  foreach ($d in (Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3')) {
    $out += [ordered]@{ letter = $d.DeviceID; freeGb = [math]::Round($d.FreeSpace / 1GB, 1); sizeGb = [math]::Round($d.Size / 1GB, 1) }
  }
  return $out
}

function miner {
  if (-not $MinerApi) { return $null }
  try {
    $j = Invoke-RestMethod -Uri $MinerApi -TimeoutSec 6
    $a = if ($j.algorithms) { $j.algorithms[0] } elseif ($j.mining) { $j.mining } else { $j }
    return [ordered]@{
      algo     = $a.name
      rate     = $a.hashrate.'1min'
      accepted = $a.shares.accepted
      rejected = $a.shares.rejected
      pool     = $a.pool.pool
      since    = $a.pool.time_connected
    }
  } catch { return [ordered]@{ error = $_.Exception.Message } }
}

function reading {
  $os = Get-CimInstance Win32_OperatingSystem
  [ordered]@{
    # .shim, never .id: this machine is not a node, and calling it one would be the lie the roster exists to avoid
    tier     = 'shim'
    ref      = $Ref
    at       = nowIso
    host     = $env:COMPUTERNAME
    user     = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    os       = $os.Caption
    uptimeMin = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalMinutes, 1)
    cpuPct   = $null
    gpus     = gpus
    disks    = disks
    miner    = miner
    how      = 'ssh-monitored box: no Hydra modules, measured by node-shim.ps1'
    source   = 'node-shim'
  }
}

function post($body) {
  $json = $body | ConvertTo-Json -Depth 6 -Compress
  Invoke-RestMethod -Uri "$Controller/api/state/register" -Method Post -ContentType 'application/json' `
    -Body (@{ name = "node.$Ref.shim"; content = $body } | ConvertTo-Json -Depth 6 -Compress) -TimeoutSec 10 | Out-Null
}

if ($Once) {
  $r = reading
  post $r
  Write-Output ("posted node.$Ref.shim  host=" + $r.host + "  gpu=" + (($r.gpus | ForEach-Object { $_.name }) -join ',') + "  miner=" + ($(if ($r.miner -and $r.miner.algo) { $r.miner.algo } else { 'none' })))
  exit 0
}

Write-Output ("node-shim: $Ref -> $Controller every ${IntervalSec}s (miner api: " + $(if ($MinerApi) { $MinerApi } else { 'none' }) + ")")
while ($true) {
  try {
    $r = reading
    post $r
    Write-Output ((nowIso) + " posted  host=" + $r.host + "  miner=" + $(if ($r.miner -and $r.miner.algo) { "$($r.miner.algo) $([math]::Round($r.miner.rate/1e6,2)) MH/s acc $($r.miner.accepted)" } else { 'none' }))
  } catch {
    Write-Output ((nowIso) + " post failed: " + $_.Exception.Message)
  }
  Start-Sleep -Seconds $IntervalSec
}
