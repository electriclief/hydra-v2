# THE CAUSE, most likely: I deleted %LOCALAPPDATA%\Temp and C:\Windows\Temp while the user was logged on. Windows recreates
# them at logon, not on demand, so SRBMiner has nowhere to put its kernel/workspace files and will not start. Recreate both
# with the ACLs Windows would have given them, then restart the mining task.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$userTemp = Join-Path $env:LOCALAPPDATA 'Temp'
$sysTemp  = 'C:\Windows\Temp'

Section 'recreate the temp folders'
foreach ($p in $userTemp, $sysTemp) {
  if (Test-Path $p) { '  {0} exists' -f $p }
  else {
    New-Item -ItemType Directory -Path $p -Force | Out-Null
    '  {0} recreated' -f $p
  }
}
Section 'ACLs'
& icacls $userTemp /grant ('{0}:(OI)(CI)F' -f $env:USERNAME) /T /C 2>&1 | Select-Object -Last 1 | ForEach-Object { '  user temp: ' + $_.Trim() }
& icacls $sysTemp /grant 'SYSTEM:(OI)(CI)F' '/grant' 'Administrators:(OI)(CI)F' '/grant' 'Users:(OI)(CI)M' /T /C 2>&1 | Select-Object -Last 1 | ForEach-Object { '  windows temp: ' + $_.Trim() }
Section 'write test'
foreach ($p in $userTemp, $sysTemp) {
  try { $f = Join-Path $p ('probe-' + (Get-Random) + '.tmp'); Set-Content $f 'ok' -ErrorAction Stop; Remove-Item $f -Force; '  {0} writable' -f $p } catch { '  {0} NOT writable: {1}' -f $p, $_.Exception.Message }
}
Section 'restart mining'
Stop-ScheduledTask -TaskName 'HydraMine1' -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'mine-overnight' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 5
Remove-Item 'C:\AI\logs\miner-auto.txt' -Force -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName 'HydraMine1'
for ($i = 1; $i -le 9; $i++) {
  Start-Sleep -Seconds 30
  $r = 'api down'
  try { $a = Invoke-RestMethod 'http://127.0.0.1:60220/' -TimeoutSec 8; $alg = @($a.algorithms)[0]; $r = '{0:N0} H/s  A{1} R{2}' -f $alg.hashrate.'15min', $alg.shares.accepted, $alg.shares.rejected } catch { }
  $g = @(Get-Content 'C:\AI\logs\miner-auto.txt' -ErrorAction SilentlyContinue | Where-Object { $_ -match 'GPU\d.*H/s' } | Select-Object -Last 1)
  '  t{0,4}s  {1,-26} {2}' -f ($i * 30), $r, $(if ($g.Count) { ($g[0] -replace '\s+',' ').Trim() } else { '' })
}
Section 'what the miner said'
Get-Content 'C:\AI\logs\miner-auto.txt' -ErrorAction SilentlyContinue | Where-Object { $_ -match '(?i)error|fail|cannot|temp|kernel' } | Select-Object -Last 6 | ForEach-Object { '  ' + ($_ -replace '\s+',' ').Trim() }
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=index,utilization.gpu,power.draw --format=csv,noheader
'TEMPFIX DONE'
