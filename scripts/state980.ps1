$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section 'what is running (duplicates are the failure mode here)'
$lol = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)lolminer' })
'  lolMiner instances: ' + $lol.Count
$lol | ForEach-Object { '    pid {0} session {1} :: {2}' -f $_.ProcessId, $_.SessionId, (($_.CommandLine -replace '\s+', ' ').Substring(0, [Math]::Min(150, ($_.CommandLine -replace '\s+',' ').Length))) }
$guards = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'standby-guard' })
'  guard instances: ' + $guards.Count
$guards | ForEach-Object { '    pid {0}' -f $_.ProcessId }
Section 'the autolykos2 number (lolMiner API schema: top-level GPUs)'
foreach ($port in 61235, 61236) {
  try {
    $a = Invoke-RestMethod ("http://127.0.0.1:{0}/" -f $port) -TimeoutSec 6
    $g = @($a.GPUs)[0]
    '  port {0}: algo {1}   {2} H/s   A{3} R{4}' -f $port, $a.Mining.Algorithm, [math]::Round($g.Performance_Summary, 0), $g.Shares_Accepted, $g.Shares_Rejected
  } catch { '  port {0}: {1}' -f $port, $_.Exception.Message }
}
Section 'logs that would hold the autolykos run'
Get-ChildItem 'C:\AI\miners\lolminer\*.log', 'C:\AI\logs\*.log', 'C:\AI\logs\algo-*.txt' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 4 | ForEach-Object {
  '  --- {0}  ({1:N0} B, {2:HH:mm:ss})' -f $_.Name, $_.Length, $_.LastWriteTime
  Get-Content $_.FullName -ErrorAction SilentlyContinue | Where-Object { $_ -match '(?i)autolykos|average speed|total speed|hashrate' } | Select-Object -Last 4 | ForEach-Object { '      ' + ($_ -replace '\s+', ' ').Trim() }
}
Section 'processwrapper rows that mention a miner'
try {
  $pws = Invoke-RestMethod 'http://127.0.0.1:8125/api/processes' -TimeoutSec 10
  @($pws.processes) | Where-Object { $_.name -match 'miner|standby' } | ForEach-Object { '  {0,-26} {1,-10} pid {2}' -f $_.name, $_.life, $_.pid }
} catch { '  pw api: ' + $_.Exception.Message }
Section 'hardware'
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=utilization.gpu,power.draw,clocks.mem,temperature.gpu --format=csv,noheader
'STATE980 DONE'
