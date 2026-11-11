$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section 'the 30-minute screen rule, with nothing else allowed to sleep'
& powercfg /change monitor-timeout-ac 30
& powercfg /change monitor-timeout-dc 30
& powercfg /change standby-timeout-ac 0
& powercfg /change standby-timeout-dc 0
& powercfg /change disk-timeout-ac 0
& powercfg /change hibernate-timeout-ac 0
& powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP STANDBYIDLE 0
& powercfg /setdcvalueindex SCHEME_CURRENT SUB_SLEEP STANDBYIDLE 0
& powercfg /setactive SCHEME_CURRENT
Start-Sleep -Seconds 1
$v = (& powercfg /query SCHEME_CURRENT SUB_VIDEO VIDEOIDLE) -join "`n"
$s = (& powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE) -join "`n"
'  monitor idle AC : ' + ([regex]::Match($v,'Current AC Power Setting Index: (0x[0-9a-fA-F]+)').Groups[1].Value) + '  (' + [Convert]::ToInt32([regex]::Match($v,'Current AC Power Setting Index: (0x[0-9a-fA-F]+)').Groups[1].Value,16)/60 + ' min)'
'  monitor idle DC : ' + ([regex]::Match($v,'Current DC Power Setting Index: (0x[0-9a-fA-F]+)').Groups[1].Value) + '  (' + [Convert]::ToInt32([regex]::Match($v,'Current DC Power Setting Index: (0x[0-9a-fA-F]+)').Groups[1].Value,16)/60 + ' min)'
'  standby     AC : ' + ([regex]::Match($s,'Current AC Power Setting Index: (0x[0-9a-fA-F]+)').Groups[1].Value) + '   (0x0 = never)'
'  hibernate file : ' + (Test-Path 'C:\hiberfil.sys')
Section 'how it is doing in the new room'
'  last boot: ' + (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
'  up (min) : ' + [math]::Round(((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalMinutes, 1)
& netsh wlan show interfaces 2>&1 | Select-String -Pattern 'SSID|Channel|Radio type|Receive rate|Transmit rate|Signal' | ForEach-Object { '  ' + $_.Line.Trim() }
'  on AC: ' + ((Get-CimInstance -Namespace root\wmi -ClassName BatteryStatus -ErrorAction SilentlyContinue | Select-Object -First 1).PowerOnline)
'  --- doors'
foreach ($p in 8125,8127,8133,8136,8137) {
  $c = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { '    {0} UP pid {1}' -f $p, $c.OwningProcess } else { '    {0} ---' -f $p }
}
'  --- mining'
try { $a = (Invoke-RestMethod 'http://127.0.0.1:60201/' -TimeoutSec 8).algorithms[0]; '    {0:N0} H/s  A{1} R{2}  uptime {3} s' -f $a.hashrate.'15min', $a.shares.accepted, $a.shares.rejected, $a.pool.time_connected } catch { '    api not answering' }
'  miners: ' + @(Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue).Count
'  electron: ' + @(Get-Process electron -ErrorAction SilentlyContinue).Count
'JIMS SCREEN DONE'
