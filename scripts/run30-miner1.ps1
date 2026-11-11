# The 30-minute proof run the operator asked for: one restart, then leave it alone and sample.
# Records every share, per-card rates at the end, and the instance counts that prove no orphans were spawned.
param([int]$Minutes = 30)
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$start = Get-Date
Section ('start ' + $start.ToString('HH:mm:ss'))
Stop-ScheduledTask -TaskName 'HydraMine1' -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | ForEach-Object { & taskkill.exe /F /PID $_.Id 2>&1 | Out-Null }
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'mine-overnight' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 6
'  leftover miners: ' + @(Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue).Count
Remove-Item 'C:\AI\logs\miner-auto.txt' -Force -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName 'HydraMine1'
'  task started'

$samples = @()
$lastA = -1; $lastR = -1
for ($i = 1; $i -le $Minutes; $i++) {
  Start-Sleep -Seconds 60
  $line = @{ t = $i }
  try {
    $a = Invoke-RestMethod 'http://127.0.0.1:60220/' -TimeoutSec 8
    $alg = @($a.algorithms)[0]
    $line.rate = [int]$alg.hashrate.'15min'
    $line.A = [int]$alg.shares.accepted
    $line.R = [int]$alg.shares.rejected
  } catch { $line.rate = -1; $line.A = -1; $line.R = -1 }
  $line.inst = @(Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue).Count
  $samples += [pscustomobject]$line
  $mark = ''
  if ($line.A -gt $lastA -and $lastA -ge 0) { $mark = '  <-- +' + ($line.A - $lastA) + ' share(s)' }
  if ($line.R -gt $lastR -and $lastR -ge 0) { $mark += '  REJECT +' + ($line.R - $lastR) }
  if ($line.A -ge 0) { $lastA = $line.A; $lastR = $line.R }
  '  t{0,3}m  {1,7} H/s  A{2} R{3}  miners {4}{5}' -f $i, $(if ($line.rate -ge 0) { $line.rate } else { 'api?' }), $line.A, $line.R, $line.inst, $mark
  if (Test-Path 'C:\AI\tools\MINER_STOP') { '  stop file appeared - ending'; break }
}

Section 'summary'
$ok = @($samples | Where-Object { $_.rate -gt 0 })
if ($ok.Count) {
  '  samples with a rate : {0} of {1}' -f $ok.Count, $samples.Count
  '  rate min/median/max : {0:N0} / {1:N0} / {2:N0} H/s' -f ($ok.rate | Measure-Object -Minimum).Minimum, ($ok.rate | Sort-Object)[[int]($ok.Count/2)], ($ok.rate | Measure-Object -Maximum).Maximum
}
'  accepted {0}   rejected {1}' -f $lastA, $lastR
'  max miner instances seen: {0}' -f ($samples.inst | Measure-Object -Maximum).Maximum
'  run length: ' -f
'    ' + [string]((Get-Date) - $start)
Section 'per-card final'
Get-Content 'C:\AI\logs\miner-auto.txt' -ErrorAction SilentlyContinue | Where-Object { $_ -match 'GPU\d' } | Select-Object -Last 4 | ForEach-Object { '  ' + ($_ -replace '\s+',' ').Trim() }
Section 'errors during the run'
Get-Content 'C:\AI\logs\miner-auto.txt' -ErrorAction SilentlyContinue | Where-Object { $_ -match '(?i)error|fail|cannot|not supported' } | Select-Object -Last 5 | ForEach-Object { '  ' + ($_ -replace '\s+',' ').Trim() }
Section 'hardware at the end'
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=index,name,utilization.gpu,power.draw,memory.used --format=csv,noheader
'  AMD: ' + (Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'PCI\VEN_1002&DEV_67DF*' }).Status
'  SRBMiner instances: ' + @(Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue).Count
'  supervisors: ' + @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'mine-overnight' }).Count
'  commit limit {0:N0} MB  free {1:N0} MB' -f ((Get-CimInstance Win32_OperatingSystem).TotalVirtualMemorySize / 1024), ((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1KB)
$samples | ConvertTo-Json -Compress | Set-Content 'C:\AI\logs\run30-samples.json' -Encoding UTF8
'RUN30 DONE'
