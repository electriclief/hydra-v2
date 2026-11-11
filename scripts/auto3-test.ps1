# The autolykos2 run failed while the etchash DAG was still resident - VRAM is released lazily, and my test started 4 s
# after killing the miner. So the "error in allocating memory 400" may be my timing, not the card. This run waits until
# nvidia-smi shows the framebuffer actually free before starting, and captures the correct API shape (Workers, not GPUs).
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$LOL = 'C:\AI\miners\lolminer\lolMiner.exe'
$out = 'C:\AI\logs\auto3-stdout.txt'
Remove-Item $out -Force -ErrorAction SilentlyContinue

Section 'stop the miner and WAIT for VRAM to be released'
try {
  $pws = Invoke-RestMethod 'http://127.0.0.1:8125/api/processes' -TimeoutSec 10
  @($pws.processes) | Where-Object { $_.name -match 'standby-miner' -and $_.life -eq 'running' } | ForEach-Object {
    Invoke-RestMethod -Uri ('http://127.0.0.1:8125/api/processes/' + $_.id + '/kill') -Method Post -Body '{"force":true}' -ContentType 'application/json' -TimeoutSec 10 | Out-Null
    '  killed ' + $_.id
  }
} catch { '  pw: ' + $_.Exception.Message }
Get-Process lolMiner -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
for ($i = 1; $i -le 12; $i++) {
  Start-Sleep -Seconds 10
  $used = (& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=memory.used --format=csv,noheader,nounits) -join '' 
  '  t{0,3}s  vram used {1} MiB' -f ($i * 10), $used
  if ([int]$used -lt 400) { '  framebuffer is free'; break }
}
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=memory.used,utilization.gpu,power.draw --format=csv,noheader

Section 'autolykos2 with a clean card, 150 s'
$algoArgs = @('--algo','AUTOLYKOS2','--pool','stratum+tcp://autolykos.unmineable.com:3333',
              '--user','leafdriving2.unmineable_miner_gtx980','--pass','x','--apiport','61236')
$p = Start-Process -FilePath $LOL -WorkingDirectory 'C:\AI\miners\lolminer' -ArgumentList $algoArgs `
       -RedirectStandardOutput $out -RedirectStandardError 'C:\AI\logs\auto3-stderr.txt' -PassThru -WindowStyle Hidden
'  pid ' + $p.Id
for ($i = 1; $i -le 6; $i++) {
  Start-Sleep -Seconds 25
  $last = (Get-Content $out -ErrorAction SilentlyContinue | Select-String -Pattern 'Average speed|error' | Select-Object -Last 1)
  $vram = (& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=memory.used,utilization.gpu,power.draw --format=csv,noheader)
  '  t{0,3}s  {1,-42} | {2}' -f ($i * 25), $(if ($last) { ($last.Line -replace '\s+',' ').Trim() } else { '(none)' }), $vram
}
Section 'verdict lines'
Get-Content $out -ErrorAction SilentlyContinue | Where-Object { $_ -match '(?i)average speed|error|allocating|not supported|DAG' } | Select-Object -Last 8 | ForEach-Object { '  ' + ($_ -replace '\s+',' ').Trim() }

Section 'stop the test and restart the etchash miner as a ProcessWrapper row'
Get-Process lolMiner -ErrorAction SilentlyContinue | Where-Object { $_.Id -eq $p.Id } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 8
$spec = @{ command='C:\AI\miners\lolminer\lolMiner.exe'
           args=@('--algo','ETCHASH','--pool','etchash.unmineable.com:3333','--user','leafdriving2.unmineable_miner_gtx980','--apiport','61235','--log','on')
           name='standby-miner'; cwd='C:\AI\miners\lolminer'; tag='standby' } | ConvertTo-Json -Depth 4 -Compress
try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8125/api/processes' -Method Post -Body $spec -ContentType 'application/json' -TimeoutSec 20; '  row ' + $r.process.id + ' pid ' + $r.process.pid } catch { '  pw post: ' + $_.Exception.Message }
Start-Sleep -Seconds 60
Get-Content 'C:\AI\logs\watch.log' -Tail 3 | ForEach-Object { '  ' + $_ }
'AUTO3 DONE'
