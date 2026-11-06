<#
  yue-song.ps1 — ONE song per run, for the hydra-local instance (node 123).

  This is the port of what the YuE studio server did: take style + lyrics + seed + mode,
  write the request JSON the CLI wants, run yue2.cli once, and copy the finished audio into
  the songs library. No server, no page, no browser — the run IS the song.

  Usage (the service calls exactly this):
    powershell -NoProfile -ExecutionPolicy Bypass -File yue-song.ps1 `
      -Style "<style>" -Lyrics "<lyrics>" -Seed 1985 -Cot full -Budget 16 -Title "<title>"
    add -DryRun to print the request JSON and touch nothing (no model load).

  Quoting law: the arguments arrive through the shelf's quote-aware split, so the values
  must not contain a double quote. Newlines inside the lyrics are fine and are kept.
#>
param(
  [Parameter(Mandatory = $true)][string]$Style,
  [Parameter(Mandatory = $true)][string]$Lyrics,
  [int]$Seed = 1985,
  [ValidateSet('full', 'melody', 'off')][string]$Cot = 'full',
  [ValidateSet('16', '14', '12', '10')][string]$Budget = '16',
  [string]$Title = 'song',
  [string]$Library = 'C:\Users\User\Desktop\make_music\songs',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$root  = 'C:\AI\YuE'
$model = 'C:\AI\hf\YuE2-3B'
$vae   = 'C:\AI\hf\yue-vae'
$py    = 'C:\AI\yue-venv\Scripts\python.exe'

function Slug([string]$text) {
  $s = ($text -replace '[^A-Za-z0-9]+', '-').Trim('-').ToLower()
  if ($s.Length -gt 60) { $s = $s.Substring(0, 60) }
  if (-not $s) { $s = 'song' }
  return $s
}

$job      = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir   = Join-Path $root "outputs\$job"
$reqPath  = Join-Path $root "outputs\$job.request.json"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$request = @{
  id     = $job
  style  = $Style
  lyrics = $Lyrics
  cot    = $Cot
  seed   = $Seed
} | ConvertTo-Json -Depth 4

[System.IO.File]::WriteAllText($reqPath, $request, (New-Object System.Text.UTF8Encoding($false)))

if ($DryRun) {
  Write-Host "DRY RUN - nothing loaded, nothing rendered."
  Write-Host "request: $reqPath"
  Write-Host $request
  exit 0
}

# The env the model needs; PYTHONPATH points at the yue2 package on this node.
$env:PYTHONPATH = 'C:\AI\YuE\src'
$env:HF_HOME = 'C:/AI/hf-cache'
$env:HF_HUB_DISABLE_XET = '1'
$env:PYTORCH_HIP_ALLOC_CONF = 'expandable_segments:True'
$env:PYTHONUTF8 = '1'

Write-Host ("=== SONG " + $job + "  mode=" + $Cot + "  budget=" + $Budget + " GiB  seed=" + $Seed + " ===")
Push-Location $root
try {
  & $py -u -m yue2.cli generate --model $model --vae $vae --budget $Budget --offload-ar --request $reqPath --output $outDir 2>&1 |
    ForEach-Object { $_ | Out-Host; $_ }
} finally {
  Pop-Location
}

$audio = Join-Path $outDir "$job\audio.flac"
if (Test-Path -LiteralPath $audio) {
  New-Item -ItemType Directory -Force -Path $Library | Out-Null
  $dst = Join-Path $Library ((Slug $Title) + '__YuE2-3B.flac')
  Copy-Item -LiteralPath $audio -Destination $dst -Force
  Write-Host ("SAVED: " + $dst)
} else {
  Write-Host "ERROR: no audio.flac was produced - see the log above"
  exit 4
}
