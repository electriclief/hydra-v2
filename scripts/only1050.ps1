# Decisive test: does the 1050 Ti mine when it is the ONLY NVIDIA GPU in the system?
# If yes, the failure is about two GPUs sharing resources on this chipset. If it still fails, it is the card or its slot.
# The display is on the Intel HD, so disabling the 1650 cannot black the screen.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$g1650 = 'PCI\VEN_10DE&DEV_1F82&SUBSYS_A548174B&REV_A1\4&37C305EE&0&00E0'

Section 'disable the 1650'
& pnputil /disable-device $g1650 2>&1 | ForEach-Object { '  ' + $_.Trim() }
Start-Sleep -Seconds 8
& 'C:\Windows\System32\nvidia-smi.exe' -L

Section 'mine xelishashv3 on what remains (70 s)'
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
$log = 'C:\AI\logs\only1050.txt'
Remove-Item $log -Force -ErrorAction SilentlyContinue
$p = Start-Process -FilePath 'C:\AI\miners\srb380\SRBMiner-MULTI.exe' -WorkingDirectory 'C:\AI\miners\srb380' -PassThru -WindowStyle Hidden -ArgumentList @(
  '--algorithm', 'xelishashv3', '--pool', 'stratum+tcp://xelishash.unmineable.com:3333',
  '--wallet', 'leafdriving2.unmineable_miner_miner1', '--disable-cpu',
  '--api-enable', '--api-port', '60217', '--gpu-sensors-disable', '--log-file', $log
)
Start-Sleep -Seconds 70
try {
  $a = Invoke-RestMethod 'http://127.0.0.1:60217/' -TimeoutSec 8
  $alg = @($a.algorithms)[0]
  '  rate {0} H/s  accepted {1}' -f $alg.hashrate.'15min', $alg.shares.accepted
} catch { '  api: ' + $_.Exception.Message }
try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { }
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
if (Test-Path $log) { Get-Content $log | Where-Object { $_ -match '(?i)h/s|error|cuda|program' } | Select-Object -Last 5 | ForEach-Object { '  ' + $_ } }

Section 're-enable the 1650'
& pnputil /enable-device $g1650 2>&1 | ForEach-Object { '  ' + $_.Trim() }
Start-Sleep -Seconds 10
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=index,name --format=csv,noheader
'ONLY1050 DONE'
