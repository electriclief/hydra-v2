# Is the second card's CUDA OOM actually a host-memory problem? Watch commit charge around the failure instead of guessing.
# If committed bytes approach the commit limit at the moment of the OOM, RAM is the wall. If they stay flat and low, it isn't,
# and a bigger stick would buy nothing.
$ErrorActionPreference = 'Continue'
$pf = Get-CimInstance Win32_PageFileUsage -ErrorAction SilentlyContinue
if ($pf) { $pf | ForEach-Object { 'pagefile: {0}  allocated {1} MB  peak {2} MB' -f $_.Name, $_.AllocatedBaseSize, $_.PeakUsage } }
else { 'pagefile: none' }
$cs = Get-CimInstance Win32_ComputerSystem
'ram: {0} MB total   free disk on C: {1} GB' -f [math]::Round($cs.TotalPhysicalMemory / 1MB), [math]::Round((Get-PSDrive C).Free / 1GB, 1)

Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
$log = 'C:\AI\logs\oom-diag.txt'
Remove-Item $log -Force -ErrorAction SilentlyContinue
$p = Start-Process -FilePath 'C:\AI\miners\srb380\SRBMiner-MULTI.exe' -WorkingDirectory 'C:\AI\miners\srb380' -PassThru -WindowStyle Hidden -ArgumentList @(
  '--algorithm', 'xelishashv3', '--pool', 'stratum+tcp://xelishash.unmineable.com:3333',
  '--wallet', 'leafdriving2.unmineable_miner_miner1', '--disable-cpu',
  '--api-enable', '--api-port', '60218', '--gpu-sensors-disable', '--log-file', $log
)

'--- commit charge while the miner initialises (MB)'
$peak = 0
for ($i = 0; $i -lt 18; $i++) {
  Start-Sleep -Seconds 2
  $os = Get-CimInstance Win32_OperatingSystem
  $commitLimit = (Get-Counter '\Memory\Commit Limit' -ErrorAction SilentlyContinue).CounterSamples[0].CookedValue / 1MB
  $committed = (Get-Counter '\Memory\Committed Bytes' -ErrorAction SilentlyContinue).CounterSamples[0].CookedValue / 1MB
  $avail = $os.FreePhysicalMemory / 1KB
  if ($committed -gt $peak) { $peak = $committed }
  '  t{0,2}s  avail {1,6:N0}  committed {2,7:N0}  limit {3,7:N0}  ({4:N0} %)' -f ($i * 2), $avail, $committed, $commitLimit, (100 * $committed / $commitLimit)
}
'  peak committed: {0:N0} MB' -f $peak

'--- what the miner logged'
if (Test-Path $log) { Get-Content $log | Where-Object { $_ -match '(?i)error|cuda|h/s|init' } | Select-Object -Last 8 | ForEach-Object { '  ' + $_ } }
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
'OOMDIAG DONE'
