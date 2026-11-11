# Steady state, not a snapshot: 10 minutes of ETCHASH with the card polled every 20 s, plus the miner's own
# hashrate from its API so we know it is hashing and not just drawing power.
$ErrorActionPreference = 'Continue'
$exe = 'C:\Users\User\lolMiner.exe'
$api = 60150
function Section($t) { '' ; '=== ' + $t }
Get-Process lolMiner -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 6

Section 'idle before'
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=temperature.gpu,fan.speed,power.draw --format=csv,noheader

Section 'start ETCHASH (10 minutes)'
$p = Start-Process -FilePath $exe -ArgumentList @(
  '--algo','ETCHASH','--pool','etchash.unmineable.com:3333',
  '--user','leafdriving2.unmineable_miner_xpsw','--pass','x','--apiport',$api,'--nocolor'
) -PassThru -WindowStyle Hidden
'  pid ' + $p.Id
Start-Sleep -Seconds 50

$temps = @()
Section 'samples'
for ($i = 1; $i -le 30; $i++) {
  $s = ((& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=temperature.gpu,fan.speed,power.draw,clocks.sm --format=csv,noheader) -join '') -split ',\s*'
  $rate = 'api?'
  try {
    $j = Invoke-RestMethod ("http://127.0.0.1:$api/") -TimeoutSec 5
    $w = @($j.Workers)[0]
    if ($w) { $rate = '{0:N1} MH/s' -f (($w.Speed_Bing / 1000.0)) }
    if (-not $w -and $j.Performance_Summary) { $rate = [string]$j.Performance_Summary }
  } catch { }
  $temps += [int]$s[0]
  '  t{0,4}s  {1,3} C  fan {2,4}  {3,8} W  sm {4}  {5}' -f ($i*20+50), $s[0], $s[1], $s[2], $s[3], $rate
  Start-Sleep -Seconds 20
}

Section 'verdict'
$mx = ($temps | Measure-Object -Maximum).Maximum
$last5 = ($temps | Select-Object -Last 5) -join ' '
'  max temp {0} C   last five samples: {1}' -f $mx, $last5
'  plateau test: if the last five are within 2 C of each other, that is the steady state'
if ($mx -lt 83) { '  VERDICT: under the 83 C target - usable for 24/7 with the rack' }
elseif ($mx -lt 90) { '  VERDICT: over the 83 C target but below throttle - workable, watch it' }
else { '  VERDICT: too hot - the card own fan still reports 0 %, fix the fan before running it hard' }
Section 'stop'
if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 8
'  after: ' + ((& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=temperature.gpu,fan.speed,power.draw --format=csv,noheader) -join '')
'THERMAL2 DONE'
