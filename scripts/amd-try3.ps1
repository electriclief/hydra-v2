$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$lol = 'C:\AI\miners\lolminer\lolMiner.exe'
$user = 'leafdriving2.unmineable_miner_miner1'

Section 'device table'
$dev = & $lol --list-devices 2>&1
$idx = $null; $amd = $null
foreach ($line in $dev) {
  if ($line -match '^\s*Device\s+(\d+)\s*:') { $idx = [int]$Matches[1]; $name = '' }
  if ($line -match '^\s*Name:\s*(.+?)\s*$' -and $null -ne $idx) {
    $name = $Matches[1]
    '  device {0} = {1}' -f $idx, $name
    if ($name -match '(?i)r9 200|radeon') { $amd = $idx }
  }
}
'  AMD device index: ' + $(if ($null -ne $amd) { $amd } else { 'NOT FOUND' })

if ($null -ne $amd) {
  $pairs = @(
    @{ algo = 'ETCHASH';    pool = 'etchash.unmineable.com:3333' },
    @{ algo = 'AUTOLYKOS2'; pool = 'autolykos.unmineable.com:3333' }
  )
  foreach ($pair in $pairs) {
    Section ("$($pair.algo) on device $amd only, 60 s")
    $log = 'C:\AI\logs\amd-' + $pair.algo + '.txt'
    Remove-Item $log -Force -ErrorAction SilentlyContinue
    $p = Start-Process -FilePath $lol -WorkingDirectory 'C:\AI\miners\lolminer' -PassThru -NoNewWindow -ArgumentList @(
      '--algo', $pair.algo, '--pool', $pair.pool, '--user', $user, '--devices', "$amd",
      '--apiport', '61240', '--log', 'on', '--logfile', $log
    )
    Start-Sleep -Seconds 60
    if (-not $p.HasExited) { try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { } }
    Start-Sleep -Seconds 3
    if (Test-Path $log) {
      $t = Get-Content $log
      $t | Where-Object { $_ -match '(?i)device|dag|memory|error|not supported|failed|share|hashrate|Mh/s' } | Select-Object -First 12 | ForEach-Object { '  ' + $_.Trim() }
    } else { '  (no log written)' }
  }
}

Section 'restore NVIDIA mining'
Start-ScheduledTask -TaskName 'HydraMine1'
Start-Sleep -Seconds 10
Get-CimInstance Win32_Process -Filter "Name='SRBMiner-MULTI.exe'" | ForEach-Object { '  SRBMiner pid {0} session {1}' -f $_.ProcessId, $_.SessionId }
'AMDTRY3 DONE'
