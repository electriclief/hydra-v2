# One card, one row of numbers. Run this each time a card goes in, before doing anything else with it.
#   identity   : what the driver calls the card, its PCI bus id, its VRAM
#   link       : the width and speed it actually negotiated in THIS slot
#   llama.cpp  : pp (prompt) and tg (generation) tokens/s on the Vulkan backend - the card-by-card comparison
#   miner      : xelishashv3 H/s and accepted/rejected over a short fixed run
# Appends one JSON line to C:\AI\reports\miner1-cards.jsonl, so the fleet total is arithmetic, not memory.
param(
  [int]$MinerSeconds = 180,
  [string]$Model = 'C:\AI\models\qwen2.5-0.5b-q4km.gguf',
  [int]$ApiPort = 60202
)
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force 'C:\AI\reports' | Out-Null
$row = [ordered]@{ when = (Get-Date).ToString('s'); host = $env:COMPUTERNAME }

# ---- identity + link
$smi = 'C:\Windows\System32\nvidia-smi.exe'
if (Test-Path $smi) {
  $q = & $smi --query-gpu=index,name,pci.bus_id,memory.total,driver_version --format=csv,noheader,nounits
  $row.gpus = @($q | ForEach-Object {
      $p = $_ -split ','
      [ordered]@{ index = $p[0].Trim(); name = $p[1].Trim(); bus = $p[2].Trim(); vram_mb = $p[3].Trim(); driver = $p[4].Trim() }
    })
} else { $row.gpus = @(); $row.note = 'nvidia-smi absent' }

$row.links = @()
foreach ($d in @(Get-PnpDevice -PresentOnly -Class Display -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -match '^PCI\\' })) {
  $w = $null; $s = $null
  try { $w = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName 'DEVPKEY_PciDevice_CurrentLinkWidth' -ErrorAction Stop).Data } catch { }
  try { $s = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName 'DEVPKEY_PciDevice_CurrentLinkSpeed' -ErrorAction Stop).Data } catch { }
  $row.links += [ordered]@{ name = $d.FriendlyName; status = "$($d.Status)"; width = $w; speed = $s }
}

# ---- llama.cpp on Vulkan
$bench = 'C:\AI\llama\llama-bench.exe'
if ((Test-Path $bench) -and (Test-Path $Model)) {
  $raw = & $bench -m $Model -ngl 99 -p 256 -n 64 -r 2 2>&1 | Out-String
  $pp = [regex]::Match($raw, '\|\s*pp256\s*\|\s*([\d.]+)\s*±')
  $tg = [regex]::Match($raw, '\|\s*tg64\s*\|\s*([\d.]+)\s*±')
  $row.llama = [ordered]@{
    model    = (Split-Path $Model -Leaf)
    pp256    = $(if ($pp.Success) { [double]$pp.Groups[1].Value } else { $null })
    tg64     = $(if ($tg.Success) { [double]$tg.Groups[1].Value } else { $null })
    raw_tail = (($raw -split "`n") | Select-Object -Last 8) -join ' / '
  }
} else { $row.llama = @{ skipped = 'bench or model missing' } }

# ---- miner
# 3.8.6 refuses to start on Turing ("GPU recovery failed; ref=RDEB6381D") while 3.8.0 hashes at ~1.7 kH/s, so the bench
# runs the build that works. Both stay installed: 3.8.6 may still be the right build for other architectures.
$srb = 'C:\AI\miners\srb380\SRBMiner-MULTI.exe'
$srbDir = 'C:\AI\miners\srb380'
if (Test-Path $srb) {
  $log = 'C:\AI\logs\bench-miner.log'
  $proc = Start-Process -FilePath $srb -WorkingDirectory $srbDir -PassThru -WindowStyle Hidden -ArgumentList @(
    '--algorithm', 'xelishashv3',
    '--pool', 'stratum+tcp://xelishash.unmineable.com:3333',
    '--wallet', 'leafdriving2.unmineable_miner_miner1',
    '--disable-cpu', '--api-enable', '--api-port', "$ApiPort",
    '--gpu-sensors-disable', '--log-file', $log
  )
  Start-Sleep -Seconds $MinerSeconds
  try {
    $api = Invoke-RestMethod ("http://127.0.0.1:$ApiPort/") -TimeoutSec 8
    $a = @($api.algorithms) | Select-Object -First 1
    $row.miner = [ordered]@{
      algo     = $a.name
      seconds  = $MinerSeconds
      hash     = if ($api.algorithms) { $api.algorithms[0].hashrate.'15min' } else { $null }
      accepted = $a.shares.accepted
      rejected = $a.shares.rejected
      pool     = $a.pool.pool
    }
  } catch {
    $row.miner = @{ algo = 'xelishashv3'; seconds = $MinerSeconds; error = $_.Exception.Message }
  }
  try { Stop-Process -Id $proc.Id -Force -ErrorAction Stop } catch { }
  Get-Process -Name 'SRBMiner-MULTI' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  if (Test-Path $log) { $row.miner_log_tail = ((Get-Content $log -Tail 4) -join ' / ') }
} else { $row.miner = @{ skipped = 'SRBMiner missing' } }

$line = ($row | ConvertTo-Json -Depth 6 -Compress)
Add-Content -Path 'C:\AI\reports\miner1-cards.jsonl' -Value $line -Encoding UTF8
$line
'CARD-BENCH DONE'
