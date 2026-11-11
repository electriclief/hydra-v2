# Thermal test with the real workload: 4 minutes of ETCHASH on the GTX 1060, sampling the card every 10 s.
# The verdict is the MAX temperature and whether the fan is actually being driven - the roster recorded
# 88 C with fan 0 % before the fan rack went in.
$ErrorActionPreference = 'Continue'
$exe = 'C:\Users\User\lolMiner.exe'
$log = 'C:\Users\User\xpsw-thermal.log'
$api = 60150
function Section($t) { '' ; '=== ' + $t }
if (-not (Test-Path $exe)) { 'lolMiner missing at ' + $exe; 'THERMAL FAILED'; exit 1 }

Section 'before (idle)'
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=temperature.gpu,fan.speed,power.draw,clocks.sm,utilization.gpu --format=csv,noheader

Section 'start ETCHASH'
Remove-Item $log -Force -ErrorAction SilentlyContinue
$p = Start-Process -FilePath $exe -ArgumentList @(
  '--algo','ETCHASH','--pool','etchash.unmineable.com:3333',
  '--user','leafdriving2.unmineable_miner_xpsw','--pass','x',
  '--apiport',$api,'--nocolor','--logfile',$log
) -PassThru -WindowStyle Hidden
'  pid ' + $p.Id
Start-Sleep -Seconds 45   # DAG build before the numbers mean anything

Section 'sample (temp / fan / watts / sm clock / util)'
$rows = @()
for ($i = 1; $i -le 22; $i++) {
  $line = (& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=temperature.gpu,fan.speed,power.draw,clocks.sm,utilization.gpu --format=csv,noheader) -join ''
  $parts = $line -split ',\s*'
  $rows += ,@([int]$parts[0], ($parts[1] -replace '%','').Trim(), ($parts[2] -replace '\s*W','').Trim(), $parts[3].Trim(), ($parts[4] -replace '%','').Trim())
  '  t{0,3}s  {1,3} C   fan {2,4}   {3,7} W   sm {4}   util {5,3}' -f ($i*10), $parts[0], $parts[1], $parts[2], $parts[3], $parts[4]
  Start-Sleep -Seconds 10
}

Section 'verdict'
$maxT = ($rows | ForEach-Object { $_[0] } | Measure-Object -Maximum).Maximum
$maxF = ($rows | ForEach-Object { [int]($_[1] -replace '[^0-9]','') } | Measure-Object -Maximum).Maximum
$maxW = ($rows | ForEach-Object { [double]($_[2] -replace '[^0-9\.]','') } | Measure-Object -Maximum).Maximum
'  max temp {0} C   max fan {1} %   max power {2:N1} W' -f $maxT, $maxF, $maxW
'  threshold: slowdown 99 C, shutdown 102 C, target 83 C'
if ($maxF -le 5) { '  FAN NOT DRIVEN: reports {0} % while at {1} C - the rack is not the fix, the fan lead/curve is' -f $maxF, $maxT }
Section 'what the miner itself said'
if (Test-Path $log) { Get-Content $log -Tail 6 | ForEach-Object { '  ' + ($_ -replace '\s+',' ').Trim() } } else { '  no log written' }
Section 'stop the test'
if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 8
'  miner alive: ' + (-not $p.HasExited)
'  after: ' + ((& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=temperature.gpu,fan.speed,power.draw --format=csv,noheader) -join '')
'THERMAL DONE'
