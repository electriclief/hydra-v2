$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$lol = 'C:\AI\miners\lolminer\lolMiner.exe'
$user = 'leafdriving2.unmineable_miner_miner1'

Section 'stop the supervisor and the miner so nothing else holds a card'
Stop-ScheduledTask -TaskName 'HydraMine1' -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'mine-overnight' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 5

Section 'lolMiner device list'
$dev = & $lol --list-devices 2>&1
$dev | ForEach-Object { '  ' + $_ }
$amdLine = $dev | Where-Object { $_ -match '(?i)r9 200|pitcairn|radeon' } | Select-Object -First 1
$amdIdx = $null
if ($amdLine -match '^\s*(\d+)\s*[:\-]') { $amdIdx = $Matches[1] }
'  AMD index detected: ' + $amdIdx

if ($null -ne $amdIdx) {
  foreach ($algo in 'ETCHASH', 'AUTOLYKOS2') {
    Section ("attempt $algo on the R9 only (60 s)")
    $log = "C:\AI\logs\amd-$algo.txt"
    Remove-Item $log -Force -ErrorAction SilentlyContinue
    $p = Start-Process -FilePath $lol -WorkingDirectory 'C:\AI\miners\lolminer' -PassThru -NoNewWindow -ArgumentList @(
      '--algo', $algo, '--pool', ("{0}.unmineable.com:3333" -f $algo.ToLower() -replace 'etchash', 'etchash' -replace 'autolykos2', 'autolykos'),
      '--user', $user, '--devices', "$amdIdx", '--apiport', '61240', '--log', 'on', '--logfile', $log
    )
    Start-Sleep -Seconds 60
    if (-not $p.HasExited) { try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { } }
    Start-Sleep -Seconds 3
    if (Test-Path $log) {
      $t = Get-Content $log
      $t | Where-Object { $_ -match '(?i)GPU\s*\d|dag|memory|error|not supported|no device|failed' } | Select-Object -First 10 | ForEach-Object { '  ' + $_.Trim() }
    } else { '  (no log written)' }
  }
}

Section 'put the NVIDIA mining back'
Start-ScheduledTask -TaskName 'HydraMine1'
Start-Sleep -Seconds 8
Get-CimInstance Win32_Process -Filter "Name='SRBMiner-MULTI.exe'" | ForEach-Object { '  SRBMiner pid {0} session {1}' -f $_.ProcessId, $_.SessionId }
'AMDTRY2 DONE'
