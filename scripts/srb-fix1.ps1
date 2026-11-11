# Five SRBMiner processes were alive at once (4564, 6408, 4192, 8904, 3880) plus the supervisor, which restarted on
# "no hashrate after warm-up" four times. Each instance boots, prints its version and then dies before it can enumerate
# a device - the signature of OpenCL kernels that cannot be compiled or cached. Clean slate, then one foreground run so
# the real error text is visible instead of being swallowed by the supervisor's restart loop.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section 'stop everything, including the orphans my restarts left behind'
Stop-ScheduledTask -TaskName 'HydraMine1' -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
$srbs = @(Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue)
'  SRBMiner instances found: ' + $srbs.Count
$srbs | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue; '    killed pid ' + $_.Id }
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'mine-overnight' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; '    killed supervisor ' + $_.ProcessId }
Start-Sleep -Seconds 6
'  remaining SRBMiner: ' + @(Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue).Count

Section 'temp folders'
foreach ($p in (Join-Path $env:LOCALAPPDATA 'Temp'), 'C:\Windows\Temp') {
  if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null; '  recreated ' + $p } else { '  exists ' + $p }
}

Section 'one foreground list-devices, full output'
$o = 'C:\AI\logs\srb-list.txt'
$e = 'C:\AI\logs\srb-list-err.txt'
Remove-Item $o, $e -Force -ErrorAction SilentlyContinue
$p = Start-Process -FilePath 'C:\AI\miners\srb380\SRBMiner-MULTI.exe' -ArgumentList '--list-devices' -WorkingDirectory 'C:\AI\miners\srb380' -RedirectStandardOutput $o -RedirectStandardError $e -PassThru -WindowStyle Hidden
if (-not $p.WaitForExit(120000)) { '  still running after 120s - killing'; Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
'  exit code: ' + $p.ExitCode
'  --- stdout'
Get-Content $o -ErrorAction SilentlyContinue | Select-Object -First 25 | ForEach-Object { '    ' + ($_ -replace "`0",'') }
'  --- stderr'
Get-Content $e -ErrorAction SilentlyContinue | Select-Object -First 15 | ForEach-Object { '    ' + ($_ -replace "`0",'') }

Section 'memory state'
'  commit limit {0:N0} MB   free physical {1:N0} MB' -f ((Get-CimInstance Win32_OperatingSystem).TotalVirtualMemorySize / 1024), ((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1KB)
'SRBFIX1 DONE'
