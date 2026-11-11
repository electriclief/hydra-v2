$ErrorActionPreference = 'Continue'
$url = 'http://192.168.1.123:8140/node22.tgz'
$dst = 'C:\Users\User\node22.tgz'
'reach page server:'
try { $h = Invoke-WebRequest -Uri $url -Method Head -TimeoutSec 20 -UseBasicParsing; '  status ' + $h.StatusCode + '  length ' + $h.Headers['Content-Length'] } catch { '  HEAD failed: ' + $_.Exception.Message }

'bits service:'
$svc = Get-Service BITS -ErrorAction SilentlyContinue
'  ' + $(if ($svc) { $svc.Status } else { 'absent' })

'bits pull:'
Remove-Item $dst -Force -ErrorAction SilentlyContinue
try {
  Start-BitsTransfer -Source $url -Destination $dst -Description node22 -ErrorAction Stop
  '  ok ' + (Get-Item $dst).Length
} catch {
  '  BITS failed: ' + $_.Exception.Message
}

if (-not (Test-Path $dst)) {
  'webrequest pull:'
  try {
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $url -OutFile $dst -TimeoutSec 600 -UseBasicParsing
    '  ok ' + (Get-Item $dst).Length
  } catch { '  webrequest failed: ' + $_.Exception.Message }
}

if (Test-Path $dst) {
  $len = (Get-Item $dst).Length
  'size ' + $len + ' (expected 42596422)'
  if ($len -eq 42596422) {
    New-Item -ItemType Directory -Path 'C:\AI\hydra-local\tools' -Force | Out-Null
    & tar -xzf $dst -C 'C:\AI\hydra-local\tools'
    'tar exit ' + $LASTEXITCODE
    if (Test-Path 'C:\AI\hydra-local\tools\node\node.exe') { 'node: ' + (& 'C:\AI\hydra-local\tools\node\node.exe' -v); Remove-Item $dst -Force } else { 'node missing after extract' }
  } else { 'size mismatch, not extracting' }
}
'NODE PULL DONE'
