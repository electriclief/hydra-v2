# Decisive test: same binary, same flags, started in SESSION 0 (the way the thermal test ran this morning at 96 W and
# 1823 MHz) instead of in the interactive session. The current miner sits at 721/810 MHz and 22 W with throttle reason
# GpuIdle while the desktop session is live, which is why it only reports 4 MH/s.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$exe = 'C:\AI\miners\lolminer\lolMiner.exe'
$args = '--algo ETCHASH --pool etchash.unmineable.com:3333 --user leafdriving2.unmineable_miner_xpsw --pass x --apiport 60151 --nocolor'

Section '1. stop whatever is mining now'
try { @(Invoke-RestMethod 'http://127.0.0.1:8125/api/processes' -TimeoutSec 8).processes | Where-Object { $_.name -eq 'standby-miner' } | ForEach-Object { Invoke-RestMethod -Method Post -Uri ('http://127.0.0.1:8125/api/processes/' + $_.id + '/kill') -Body '{"force":true}' -ContentType 'application/json' -TimeoutSec 15 | Out-Null; '  killed ' + $_.id } } catch { '  pw kill failed: ' + $_.Exception.Message }
Get-Process lolMiner -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 8
'  lolMiner left: ' + @(Get-Process lolMiner -ErrorAction SilentlyContinue).Count

Section '2. start it detached (session 0)'
$cmd = 'cmd.exe /c "' + $exe + ' ' + $args + ' >> C:\AI\logs\lolminer-session0.log 2>&1"'
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd }
'  returnValue=' + $r.ReturnValue + '  pid=' + $r.ProcessId
Section '3. let it build the DAG and boost'
for ($i = 1; $i -le 8; $i++) {
  Start-Sleep -Seconds 20
  $clk = (& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=clocks.sm,clocks.mem,power.draw,temperature.gpu,pstate --format=csv,noheader) -join ''
  $rate = 'api?'
  try { $a = Invoke-RestMethod 'http://127.0.0.1:60151/' -TimeoutSec 5; $rate = '{0:N2} MH/s' -f (@($a.Algorithms)[0].Total_Performance) } catch { }
  '  t{0,3}s  {1}  {2}' -f ($i*20), $clk, $rate
}
Section '4. session of the miner process'
Get-CimInstance Win32_Process -Filter "Name='lolMiner.exe'" | ForEach-Object { '  pid {0} session {1}' -f $_.ProcessId, $_.SessionId }
'XPSW SESSION0 TEST DONE'
