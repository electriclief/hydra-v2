$ErrorActionPreference = 'Continue'
$os = Get-CimInstance Win32_OperatingSystem
$up = [int]((Get-Date) - $os.LastBootUpTime).TotalMinutes
'{0}  boot {1:HH:mm}  up {2} min' -f $env:COMPUTERNAME, $os.LastBootUpTime, $up

$miners = @(Get-Process lolMiner, SRBMiner-MULTI, xmrig -ErrorAction SilentlyContinue)
'miners: ' + $miners.Count
$miners | ForEach-Object { '  {0} pid {1} cpu {2:N0}s' -f $_.ProcessName, $_.Id, $_.CPU }

foreach ($p in 60130, 60151, 60201, 60220, 61235) {
  try {
    $a = Invoke-RestMethod ("http://127.0.0.1:" + $p + "/") -TimeoutSec 4
    $g = @($a.Algorithms)[0]
    if ($g) { 'api {0}: {1} {2} MH/s A{3} R{4}' -f $p, $g.Algorithm, $g.Total_Performance, $g.Total_Accepted, $g.Total_Rejected }
    else { 'api {0}: answered, no algorithm field' -f $p }
  } catch { }
}
try { $s = Invoke-RestMethod 'http://127.0.0.1:60220/' -TimeoutSec 4; if ($s.hashes) { 'api 60220: {0} H/s' -f $s.hashes.total[0] } } catch { }

& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=name,temperature.gpu,power.draw,utilization.gpu --format=csv,noheader 2>$null

$ports = @(8125, 8127, 8136, 8137, 8138)
$up2 = @(); foreach ($p in $ports) { if (Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue) { $up2 += $p } }
'doors: ' + ($up2 -join ' ')
'PROBE DONE'
