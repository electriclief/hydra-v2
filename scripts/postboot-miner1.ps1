# After the 0-input reboot: did the box come up and start mining with nobody at the keyboard?
# Nothing here writes to the console or simulates input - it is all ssh, so a pass is a real pass.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section 'who is logged on (auto-logon proves itself here)'
& query session 2>&1 | ForEach-Object { '  ' + $_ }
'  uptime: ' + [math]::Round(((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalMinutes, 1) + ' minutes'
Section 'the mining task, started by its logon trigger'
'  task: ' + (Get-ScheduledTask -TaskName 'HydraMine1' -ErrorAction SilentlyContinue).State
'  trigger: ' + ((Get-ScheduledTask -TaskName 'HydraMine1' -ErrorAction SilentlyContinue).Triggers | ForEach-Object { $_.CimClass.CimClassName + ' delay ' + $_.Delay } ) -join '; '
'  supervisor: ' + (@(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'mine-overnight' }).Count) + ' instance(s)'
'  SRBMiner: ' + (@(Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue).Count) + ' instance(s)'
Section 'hashrate'
for ($i = 1; $i -le 4; $i++) {
  $r = 'api down'
  try { $a = Invoke-RestMethod 'http://127.0.0.1:60220/' -TimeoutSec 8; $alg = @($a.algorithms)[0]; $r = '{0:N0} H/s  A{1} R{2}' -f $alg.hashrate.'15min', $alg.shares.accepted, $alg.shares.rejected } catch { }
  '  t{0,3}s  {1}' -f ($i * 20), $r
  Start-Sleep -Seconds 20
}
Section 'per-card'
Get-Content 'C:\AI\logs\miner-auto.txt' -ErrorAction SilentlyContinue | Where-Object { $_ -match 'GPU\d' } | Select-Object -Last 6 | ForEach-Object { '  ' + ($_ -replace '\s+',' ').Trim() }
Section 'errors'
Get-Content 'C:\AI\logs\miner-auto.txt' -ErrorAction SilentlyContinue | Where-Object { $_ -match '(?i)error|fail|cannot|not supported' } | Select-Object -Last 6 | ForEach-Object { '  ' + ($_ -replace '\s+',' ').Trim() }
Section 'hardware + temp'
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=index,utilization.gpu,power.draw --format=csv,noheader
'  AMD: ' + (Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'PCI\VEN_1002&DEV_67DF*' }).Status
'  commit limit {0:N0} MB   free {1:N0} MB' -f ((Get-CimInstance Win32_OperatingSystem).TotalVirtualMemorySize / 1024), ((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1KB)
'  temp writable: ' + $(try { $f = Join-Path $env:LOCALAPPDATA ('t' + (Get-Random) + '.tmp'); Set-Content $f 'x'; Remove-Item $f -Force; 'yes' } catch { 'NO' })
'POSTBOOT DONE'
