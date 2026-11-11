# FINAL FORM CHECK - miner1 as it will leave the desk: 450 W PSU, three NVIDIA cards, no AMD, 0-input boot.
# Everything here is measurement; nothing simulates input.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }

Section 'boot: did it come up and log on by itself'
$os = Get-CimInstance Win32_OperatingSystem
'  last boot      : {0}' -f $os.LastBootUpTime
'  up (minutes)   : {0:N1}' -f ((Get-Date) - $os.LastBootUpTime).TotalMinutes
& query session 2>&1 | ForEach-Object { '  ' + $_ }
$wl = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
'  AutoAdminLogon : {0}   ForceAutoLogon: {1}' -f $wl.AutoAdminLogon, $wl.ForceAutoLogon

Section 'the mining task and what it runs'
$t = Get-ScheduledTask -TaskName 'HydraMine1' -ErrorAction SilentlyContinue
'  state   : {0}' -f $t.State
'  last run: {0}   result {1}' -f (Get-ScheduledTaskInfo -TaskName 'HydraMine1').LastRunTime, (Get-ScheduledTaskInfo -TaskName 'HydraMine1').LastTaskResult
$t.Triggers | ForEach-Object { '  trigger : {0}  delay {1}  enabled {2}' -f $_.CimClass.CimClassName, $_.Delay, $_.Enabled }
$t.Actions  | ForEach-Object { '  action  : {0} {1}' -f $_.Execute, $_.Arguments }
'  principal: {0}  logon {1}  runlevel {2}' -f $t.Principal.UserId, $t.Principal.LogonType, $t.Principal.RunLevel

Section 'exactly one of everything (the failure mode that cost us this morning)'
$miners = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)srbminer|lolminer' })
$sups   = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'mine-overnight' })
'  miner processes     : {0}' -f $miners.Count
$miners | ForEach-Object { '    pid {0} started {1:HH:mm:ss}' -f $_.ProcessId, $_.CreationDate }
'  supervisor processes: {0}' -f $sups.Count
$sups   | ForEach-Object { '    pid {0} started {1:HH:mm:ss}' -f $_.ProcessId, $_.CreationDate }

Section 'the patched supervisor is actually on the box'
$p = 'C:\AI\tools\mine-overnight.ps1'
if (Test-Path $p) {
  $c = Get-Content $p -Raw
  '  file    : {0}  {1:N0} B  {2}' -f $p, (Get-Item $p).Length, (Get-Item $p).LastWriteTime
  '  Stop-MinerHard present : {0}' -f [bool]($c -match 'function Stop-MinerHard')
  '  STUCK guard present    : {0}' -f [bool]($c -match 'STUCK: \{0\} miner process')
  '  running instance carries the patch: {0}' -f (($sups | ForEach-Object { $_.CreationDate }) -gt (Get-Item $p).LastWriteTime)
} else { '  MISSING ' + $p }

Section 'mining right now'
for ($i = 1; $i -le 3; $i++) {
  $r = 'api down'
  try { $a = Invoke-RestMethod 'http://127.0.0.1:60220/' -TimeoutSec 8; $alg = @($a.algorithms)[0]; $r = '{0:N0} H/s   A{1} R{2} HW{3}' -f $alg.hashrate.'15min', $alg.shares.accepted, $alg.shares.rejected, $alg.shares.hw_errors } catch { }
  '  {0}' -f $r
  Start-Sleep -Seconds 12
}
Section 'per-card'
Get-Content 'C:\AI\logs\miner-auto.txt' -ErrorAction SilentlyContinue | Where-Object { $_ -match 'GPU\d' } | Select-Object -Last 5 | ForEach-Object { '  ' + ($_ -replace '\s+',' ').Trim() }
Section 'errors in the log'
$e = @(Get-Content 'C:\AI\logs\miner-auto.txt' -ErrorAction SilentlyContinue | Where-Object { $_ -match '(?i)error|fail|cannot|not supported|0x2004' })
'  error lines: {0}' -f $e.Count
$e | Select-Object -Last 4 | ForEach-Object { '    ' + ($_ -replace '\s+',' ').Trim() }

Section 'hardware: three NVIDIA cards, no AMD'
Get-CimInstance Win32_VideoController | ForEach-Object { '  {0,-32} {1}' -f $_.Name, $_.DriverVersion }
$amd = @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like 'PCI\VEN_1002*' -and $_.Class -eq 'Display' })
'  AMD display devices present: {0}' -f $amd.Count
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=index,name,memory.total,utilization.gpu,power.draw,temperature.gpu --format=csv,noheader

Section 'host health'
'  commit limit {0:N0} MB   free physical {1:N0} MB' -f ($os.TotalVirtualMemorySize / 1024), ($os.FreePhysicalMemory / 1KB)
'  temp writable: ' + $(try { $f = Join-Path $env:LOCALAPPDATA ('t' + (Get-Random) + '.tmp'); Set-Content $f 'x'; Remove-Item $f -Force; 'yes' } catch { 'NO' })
'  C: free {0:N1} GB' -f ((Get-Volume -DriveLetter C).SizeRemaining / 1GB)
'  TdrDelay: ' + (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers' -Name TdrDelay -ErrorAction SilentlyContinue).TdrDelay
'  pagefile: ' + ((Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management').PagingFiles -join '; ')
'FINALCHECK DONE'
