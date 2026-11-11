$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$amd = 'PCI\VEN_1002&DEV_6810&SUBSYS_04641043&REV_00\4&302BABE0&0&00E4'

Section 'the test left the task Disabled and no miner running - put both back'
$t = Get-ScheduledTask -TaskName 'HydraMine1' -ErrorAction SilentlyContinue
'  task state: ' + $t.State
Get-Process lolMiner -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
if ($t.State -eq 'Disabled') { Enable-ScheduledTask -TaskName 'HydraMine1' | Out-Null; '  enabled' }
Start-ScheduledTask -TaskName 'HydraMine1'
'  started, waiting 100 s'
Start-Sleep -Seconds 100

Section 'disable the R9 again (it is coming out of the machine)'
$s = (Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -eq $amd }).Status
'  status before: ' + $s
if ($s -eq 'OK') { & pnputil /disable-device $amd 2>&1 | Select-Object -Last 2 | ForEach-Object { '  ' + $_.Trim() } }
'  status after : ' + (Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -eq $amd }).Status

Section 'state now'
'  task: ' + (Get-ScheduledTask -TaskName 'HydraMine1').State
Get-CimInstance Win32_Process -Filter "Name='SRBMiner-MULTI.exe'" | ForEach-Object { '  SRBMiner pid {0} session {1}' -f $_.ProcessId, $_.SessionId }
try {
  $a = Invoke-RestMethod 'http://127.0.0.1:60220/' -TimeoutSec 10
  $alg = @($a.algorithms)[0]
  '  {0:N0} H/s   accepted {1}   rejected {2}' -f $alg.hashrate.'15min', $alg.shares.accepted, $alg.shares.rejected
} catch { '  api: ' + $_.Exception.Message }
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=index,name,utilization.gpu --format=csv,noheader
'  llama devices:'
& 'C:\AI\llama\llama-bench.exe' --list-devices 2>&1 | Where-Object { $_ -match 'Found|Vulkan\d:' } | ForEach-Object { '    ' + ($_ -replace "`0", '') }
'RESTORE DONE'
