# Third opinion on the 980 Ti. lolMiner 1.76 and 1.98a BOTH give exactly 1.53 MH/s on etchash, so the miner version is
# not the variable. SRBMiner has its own etchash kernel: if it also lands near 1.5 MH/s the card/driver is the limit;
# if it lands nearer 25 MH/s the fault has been lolMiner all along.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$SRB = 'C:\AI\miners\srbminer\SRBMiner-MULTI.exe'
$out = 'C:\AI\logs\srb980-etchash.txt'
if (-not (Test-Path $SRB)) { 'SRBMiner missing'; 'SRB980 DONE'; exit }

Section 'devices SRBMiner can see on this card'
(& $SRB --list-devices 2>&1 | Where-Object { $_ -match '(?i)cuda|opencl|GPU\d|gtx' } | Select-Object -First 6) | ForEach-Object { '  ' + ($_ -replace "`0",'').Trim() }

Section 'stop lolMiner'
try {
  $pws = Invoke-RestMethod 'http://127.0.0.1:8125/api/processes' -TimeoutSec 10
  @($pws.processes) | Where-Object { $_.name -match 'standby-miner' -and $_.life -eq 'running' } | ForEach-Object {
    Invoke-RestMethod -Uri ('http://127.0.0.1:8125/api/processes/' + $_.id + '/kill') -Method Post -Body '{"force":true}' -ContentType 'application/json' -TimeoutSec 10 | Out-Null
    '  killed ' + $_.id
  }
} catch { '  pw: ' + $_.Exception.Message }
Get-Process lolMiner -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 20

Section 'SRBMiner etchash, 120 s'
Remove-Item $out -Force -ErrorAction SilentlyContinue
$p = Start-Process -FilePath $SRB -WorkingDirectory (Split-Path $SRB) -PassThru -WindowStyle Hidden -ArgumentList @(
  '--algorithm','etchash','--pool','stratum+tcp://etchash.unmineable.com:3333',
  '--wallet','leafdriving2.unmineable_miner_gtx980','--password','x',
  '--api-enable','--api-port','60221','--log-file',$out,'--disable-cpu'
)
'  pid ' + $p.Id
for ($i = 1; $i -le 5; $i++) {
  Start-Sleep -Seconds 25
  $r = 'api down'
  try { $a = Invoke-RestMethod 'http://127.0.0.1:60221/' -TimeoutSec 6; $alg = @($a.algorithms)[0]; $r = '{0:N2} MH/s  A{1} R{2}' -f ($alg.hashrate.'15min'/1e6), $alg.shares.accepted, $alg.shares.rejected } catch { }
  '  t{0,3}s  {1,-30} | {2}' -f ($i*25), $r, ((& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=utilization.gpu,power.draw --format=csv,noheader))
}
Section 'log'
Get-Content $out -ErrorAction SilentlyContinue | Where-Object { $_ -match '(?i)h/s|accepted|error|not supported|kernel' } | Select-Object -Last 8 | ForEach-Object { '  ' + ($_ -replace '\s+',' ').Trim() }

Section 'put lolMiner 1.98a back'
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Where-Object { $_.Id -eq $p.Id } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 10
$spec = @{ command='C:\AI\miners\lolminer\lolMiner.exe'
           args=@('--algo','ETCHASH','--pool','etchash.unmineable.com:3333','--user','leafdriving2.unmineable_miner_gtx980','--apiport','61235','--log','on')
           name='standby-miner'; cwd='C:\AI\miners\lolminer'; tag='standby' } | ConvertTo-Json -Depth 4 -Compress
try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8125/api/processes' -Method Post -Body $spec -ContentType 'application/json' -TimeoutSec 20; '  row ' + $r.process.id + ' pid ' + $r.process.pid } catch { '  pw post: ' + $_.Exception.Message }
Start-Sleep -Seconds 70
Get-Content 'C:\AI\logs\watch.log' -Tail 2 | ForEach-Object { '  ' + $_ }
'SRB980 DONE'
