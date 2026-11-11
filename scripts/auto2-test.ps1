# The first attempt parsed the wrong API shape ($api.Session.GPUs) and its log was overwritten by the relaunch,
# so it produced no number. This run captures lolMiner's own stdout, waits long enough for the autolykos2 DAG,
# and puts the miner back under the guard's control afterwards.
# A healthy GTX 980 Ti does ~60-70 MH/s on autolykos2. A number near zero, again, is a verdict on the card's
# compute path rather than on the etchash kernel.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$LOL   = 'C:\AI\miners\lolminer\lolMiner.exe'
$out   = 'C:\AI\logs\auto2-stdout.txt'
$err   = 'C:\AI\logs\auto2-stderr.txt'
Remove-Item $out, $err -Force -ErrorAction SilentlyContinue

Section 'clear the card'
Get-Process lolMiner -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 4

Section 'autolykos2, 150 seconds, stdout captured'
$algoArgs = @('--algo', 'AUTOLYKOS2', '--pool', 'stratum+tcp://autolykos.unmineable.com:3333',
              '--user', 'leafdriving2.unmineable_miner_gtx980', '--pass', 'x', '--apiport', '61236')
$p = Start-Process -FilePath $LOL -WorkingDirectory 'C:\AI\miners\lolminer' -ArgumentList $algoArgs `
      -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -WindowStyle Hidden
'  pid ' + $p.Id
for ($i = 1; $i -le 6; $i++) {
  Start-Sleep -Seconds 25
  $rate = (Get-Content $out -ErrorAction SilentlyContinue | Select-String -Pattern 'Average speed|Total speed' | Select-Object -Last 1)
  '  t{0,4}s  {1}' -f ($i * 25), $(if ($rate) { ($rate.Line -replace '\s+', ' ').Trim() } else { '(no rate line yet)' })
}
Section 'what the card did'
Get-Content $out -ErrorAction SilentlyContinue | Where-Object { $_ -match '(?i)average speed|total speed|dag|error|not supported|memory' } | Select-Object -Last 10 | ForEach-Object { '  ' + ($_ -replace '\s+', ' ').Trim() }
if (Test-Path $err) { $e = Get-Content $err -ErrorAction SilentlyContinue | Select-Object -Last 5; if ($e) { '  stderr: '; $e | ForEach-Object { '    ' + $_ } } }
try { $a = Invoke-RestMethod 'http://127.0.0.1:61236/' -TimeoutSec 6; $g = @($a.GPUs)[0]; '  api: {0} H/s  A{1}' -f [math]::Round($g.Performance_Summary, 0), $g.Shares_Accepted } catch { '  api: ' + $_.Exception.Message }

Section 'stop the test'
Get-Process lolMiner -ErrorAction SilentlyContinue | Where-Object { $_.Id -eq $p.Id } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
'  stopped'

Section 'hand mining back: pin the miner up so the guard starts it now, not after 30 minutes'
New-Item -ItemType Directory -Force -Path 'C:\AI\hydra-local\data\standby' | Out-Null
Set-Content -Path 'C:\AI\hydra-local\data\standby\standby.pin' -Value ('pinned by 123 after the autolykos2 test ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) -Encoding ascii
'  pin written'
for ($i = 1; $i -le 8; $i++) {
  Start-Sleep -Seconds 15
  $m = Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)lolminer' }
  if ($m) { '  miner up after {0}s: pid {1}' -f ($i * 15), ($m | Select-Object -First 1).ProcessId; break }
  if ($i -eq 8) { '  miner not up after 120s - the guard may be waiting on its grace timer' }
}
Section 'final state'
Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)lolminer' } | ForEach-Object { '  lolMiner pid {0}' -f $_.ProcessId }
try { $a = Invoke-RestMethod 'http://127.0.0.1:61235/' -TimeoutSec 8; $g = @($a.GPUs)[0]; '  etchash: {0} MH/s  A{1} R{2}' -f [math]::Round($g.Performance_Summary / 1e6, 2), $g.Shares_Accepted, $g.Shares_Rejected } catch { '  api 61235: ' + $_.Exception.Message }
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=utilization.gpu,power.draw --format=csv,noheader
'AUTO2 DONE'
