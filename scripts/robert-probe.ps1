$ErrorActionPreference = 'Continue'
$os = Get-CimInstance Win32_OperatingSystem
'robert: boot {0:HH:mm}  up {1} min' -f $os.LastBootUpTime, [int]((Get-Date) - $os.LastBootUpTime).TotalMinutes

'sessions:'
& query session 2>&1 | ForEach-Object { '  ' + $_ }

'processes:'
Get-CimInstance Win32_Process -Filter "Name='SRBMiner-MULTI.exe' or Name='xmrig.exe' or Name='lolMiner.exe'" |
  ForEach-Object { '  pid {0} {1}' -f $_.ProcessId, (([string]$_.CommandLine) -replace '\s+',' ') }

'listening miner-ish ports:'
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 21550,21551,60130,60131,60201,60202,6009,3333 } |
  ForEach-Object { '  ' + $_.LocalPort }

foreach ($p in 21550, 60130, 60131, 60201) {
  try { $a = Invoke-RestMethod ("http://127.0.0.1:" + $p + "/") -TimeoutSec 4; 'api {0}: {1}' -f $p, (($a | ConvertTo-Json -Depth 3 -Compress).Substring(0, [Math]::Min(220, ($a | ConvertTo-Json -Depth 3 -Compress).Length))) } catch { }
}

'gpu:'
& 'C:\Windows\System32\wbem\wmic.exe' path win32_VideoController get name,driverversion 2>&1 | Where-Object { $_ -match '\S' } | Select-Object -First 4

'the guard log, if there is one:'
$g = 'C:\AI\hydra-local\data\standby\guard.log'
if (Test-Path $g) { Get-Content $g -Tail 6 | ForEach-Object { '  ' + ($_ -replace '\s+',' ').Trim() } } else { '  no guard.log' }
'ROBERT PROBE DONE'
