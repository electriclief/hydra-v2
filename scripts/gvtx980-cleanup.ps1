# gtx-980ti .134 "boots to our old menu": it boots into Hydra V1 and runs three miners at once, none of them the one
# Hydra has registered. Evidence from the probe:
#   v1 Hydra   C:\Hydra\electron\electron.exe (pid 6704) + Run key HydraGuardian -> Downloads\HydraGuardian-v1.9.exe
#              + tasks hydra-pw-window / hydra-consoles -> C:\Hydra\module\boot\*.cmd
#   miners     lolMiner --algo BEAM-III (from echidna-mine-gpu.cmd), lolMiner 1.26 from Desktop\...\etchash, xmrig (cpu)
#   registered node.json standby wants C:\AI\miners\lolminer\lolMiner.exe --apiport 61235 --user ...gtx980 -- algo ETCHASH
# That is three programs fighting for one card, which is a perfectly good reason for the "1.53 MH/s" the card has been
# blamed for. This script removes the v1 shell, parks the old starters, and leaves exactly one managed miner.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$removed = @()

Section '1. what is running before we touch it'
Get-CimInstance Win32_Process | Where-Object { $_.Name -in 'lolMiner.exe','xmrig.exe','electron.exe' } |
  ForEach-Object { '  {0,-14} pid {1,-6} {2}' -f $_.Name, $_.ProcessId, ((([string]$_.ExecutablePath)) ) }

Section '2. stop the v1 Hydra shell'
$v1 = @(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { ([string]$_.ExecutablePath) -like 'C:\Hydra\*' })
foreach ($p in $v1) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; $removed += ('v1 electron pid ' + $p.ProcessId) }
'  stopped v1 electron: ' + $v1.Count
Get-Process HydraGuardian -ErrorAction SilentlyContinue | ForEach-Object { $_.Kill(); $removed += 'HydraGuardian pid ' + $_.Id }
$run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
if ((Get-ItemProperty $run -ErrorAction SilentlyContinue).PSObject.Properties.Name -contains 'HydraGuardian') {
  Remove-ItemProperty -Path $run -Name 'HydraGuardian' -Force -ErrorAction SilentlyContinue
  $removed += 'Run\HydraGuardian'
}
foreach ($t in 'hydra-pw-window','hydra-consoles') {
  if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) { Disable-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue | Out-Null; $removed += ('task ' + $t + ' disabled') }
}

Section '3. stop the old miner starters and every loose miner'
foreach ($t in 'echidna-mine','echidna-mine-gpu') {
  if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue; Disable-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue | Out-Null; $removed += ('task ' + $t + ' stopped+disabled') }
}
foreach ($n in 'lolMiner','xmrig') {
  $ps = @(Get-Process $n -ErrorAction SilentlyContinue)
  if ($ps.Count) { $ps | Stop-Process -Force -ErrorAction SilentlyContinue; $removed += ($n + ' x' + $ps.Count) }
}
Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | Where-Object { ([string]$_.CommandLine) -match 'echidna-mine|unminable' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $removed += ('old starter cmd ' + $_.ProcessId) }
Start-Sleep -Seconds 6
'  miners left: ' + (@(Get-Process lolMiner,xmrig -ErrorAction SilentlyContinue).Count)

Section '4. old startup shortcuts off the desktop login'
$startup = [Environment]::GetFolderPath('Startup')
Get-ChildItem $startup -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.Name -match 'unminable|Mining wall') { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue; $removed += ('startup ' + $_.Name) }
}
Get-ChildItem $startup -ErrorAction SilentlyContinue | ForEach-Object { '  keeps: ' + $_.Name }

Section '5. start the ONE managed miner that Hydra knows about'
$body = @{
  name = 'standby-miner'; tag = 'standby'; isolation = 'supervised'
  command = 'C:\AI\miners\lolminer\lolMiner.exe'
  args = @('--algo','ETCHASH','--pool','etchash.unmineable.com:3333','--user','leafdriving2.unmineable_miner_gtx980','--apiport','61235','--log','on','--logfile','C:\AI\logs\lolmine.log')
  cwd = 'C:\AI\miners\lolminer'
} | ConvertTo-Json -Depth 4
try {
  $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8125/api/processes' -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 20
  '  row: ' + $r.process.id + '  life: ' + $r.process.life + '  duplicate: ' + $r.duplicate
} catch { '  start failed: ' + $_.Exception.Message }

Section '6. five minutes of truth'
for ($i = 1; $i -le 10; $i++) {
  Start-Sleep -Seconds 30
  $api = 'no answer'
  try { $a = Invoke-RestMethod 'http://127.0.0.1:61235/' -TimeoutSec 5; $g = @($a.Algorithms)[0]; $api = ('{0:N3} MH/s  A{1} R{2}' -f $g.Total_Performance, $g.Total_Accepted, $g.Total_Rejected) } catch { }
  $gpu = ((& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=temperature.gpu,power.draw,utilization.gpu --format=csv,noheader) -join '') -replace '\s+',' '
  '  t{0,3}s  {1}  {2}' -f ($i*30), $gpu, $api
}

Section '7. what we removed'
$removed | ForEach-Object { '  - ' + $_ }
'GVTX980 CLEANUP DONE'
