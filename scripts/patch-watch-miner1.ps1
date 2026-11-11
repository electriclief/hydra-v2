# The box is booting and mining by itself, but the patched supervisor never made it onto the node (the earlier scp died with
# the connection). Deploy it, then restart once so the process actually running is the patched one - and give it long enough
# to finish SRBMiner's auto-tune before believing any hashrate number.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section 'is the patch on the box now'
$p = 'C:\AI\tools\mine-overnight.ps1'
$c = if (Test-Path $p) { Get-Content $p -Raw } else { '' }
'  file    : {0}  {1:N0} B  {2}' -f $p, (Get-Item $p).Length, (Get-Item $p).LastWriteTime
'  Stop-MinerHard : {0}' -f [bool]($c -match 'function Stop-MinerHard')
'  STUCK guard    : {0}' -f [bool]($c -match 'STUCK:')
Section 'previous supervisor backup'
Copy-Item $p 'C:\AI\tools\mine-overnight.ps1.bak' -Force -ErrorAction SilentlyContinue
'  kept as mine-overnight.ps1.bak'
Section 'clean restart so the running process is the patched one'
Stop-ScheduledTask -TaskName 'HydraMine1' -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 3
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | ForEach-Object { & taskkill.exe /F /T /PID $_.Id 2>&1 | Out-Null }
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'mine-overnight' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 6
'  survivors: ' + @(Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue).Count
Remove-Item 'C:\AI\logs\miner-auto.txt' -Force -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName 'HydraMine1'
'  started'
Section 'watch 6 minutes (auto-tune runs first)'
for ($i = 1; $i -le 12; $i++) {
  Start-Sleep -Seconds 30
  $r = 'api ...'
  try { $a = Invoke-RestMethod 'http://127.0.0.1:60220/' -TimeoutSec 8; $alg = @($a.algorithms)[0]; $r = '{0:N0} H/s A{1} R{2}' -f $alg.hashrate.'15min', $alg.shares.accepted, $alg.shares.rejected } catch { }
  '  t{0,3}s  {1,-26} miners={2} sup={3}' -f ($i*30), $r, @(Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue).Count, @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'mine-overnight' }).Count
}
Section 'per card at the end'
Get-Content 'C:\AI\logs\miner-auto.txt' -ErrorAction SilentlyContinue | Where-Object { $_ -match 'GPU\d.*H/s|GPU\d.*found|INTENSITY' } | Select-Object -Last 8 | ForEach-Object { '  ' + ($_ -replace '\s+',' ').Trim() }
Section 'supervisor trail'
Get-Content 'C:\AI\logs\supervisor.txt' -Encoding UTF8 -ErrorAction SilentlyContinue | Select-Object -Last 6 | ForEach-Object { '  ' + $_ }
Section 'errors'
Get-Content 'C:\AI\logs\miner-auto.txt' -ErrorAction SilentlyContinue | Where-Object { $_ -match '(?i)error|fail|cannot|out of memory' } | Select-Object -Last 4 | ForEach-Object { '  ' + ($_ -replace '\s+',' ').Trim() }
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=index,name,utilization.gpu,power.draw,memory.used --format=csv,noheader
'PATCH+WATCH DONE'
