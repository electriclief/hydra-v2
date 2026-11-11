$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section 'uptime and session'
'  last boot: ' + (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
'  up minutes: ' + [math]::Round(((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalMinutes, 1)
& query session 2>&1 | ForEach-Object { '  ' + $_ }
Section 'task and trigger'
$t = Get-ScheduledTask -TaskName 'HydraMine1' -ErrorAction SilentlyContinue
'  state: ' + $t.State
$t.Triggers | ForEach-Object { '  trigger: {0}  delay {1}  enabled {2}' -f $_.CimClass.CimClassName, $_.Delay, $_.Enabled }
$t.Actions | ForEach-Object { '  action: {0} {1}' -f $_.Execute, $_.Arguments }
Section 'WHY there are two: every miner and supervisor with its start time'
Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)srbminer|lolminer' -or ($_.Name -eq 'powershell.exe' -and $_.CommandLine -match 'mine-overnight') } |
  Sort-Object CreationDate | ForEach-Object {
    '  pid {0,-6} parent {1,-6} started {2:HH:mm:ss}  {3}' -f $_.ProcessId, $_.ParentProcessId, $_.CreationDate, (($_.CommandLine -replace '\s+',' ').Substring(0,[Math]::Min(95,($_.CommandLine -replace '\s+',' ').Length)))
  }
Section 'clean slate'
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 3
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | ForEach-Object { & taskkill.exe /F /T /PID $_.Id 2>&1 | Out-Null }
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'mine-overnight' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 5
'  survivors: ' + @(Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue).Count
Section 'one start'
Remove-Item 'C:\AI\logs\miner-auto.txt' -Force -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName 'HydraMine1'
for ($i = 1; $i -le 6; $i++) {
  Start-Sleep -Seconds 25
  $r = 'api down'
  try { $a = Invoke-RestMethod 'http://127.0.0.1:60220/' -TimeoutSec 8; $alg = @($a.algorithms)[0]; $r = '{0:N0} H/s  A{1} R{2}' -f $alg.hashrate.'15min', $alg.shares.accepted, $alg.shares.rejected } catch { }
  '  t{0,3}s  {1,-28} miners={2} supervisors={3}' -f ($i*25), $r, @(Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue).Count, @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'mine-overnight' }).Count
}
Section 'per card'
Get-Content 'C:\AI\logs\miner-auto.txt' -ErrorAction SilentlyContinue | Where-Object { $_ -match 'GPU\d' } | Select-Object -Last 4 | ForEach-Object { '  ' + ($_ -replace '\s+',' ').Trim() }
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=index,utilization.gpu,power.draw --format=csv,noheader
'DUP2 DONE'
