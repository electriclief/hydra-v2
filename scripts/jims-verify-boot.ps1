$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$os = Get-CimInstance Win32_OperatingSystem
Section 'boot'
'  last boot : ' + $os.LastBootUpTime
'  up (min)  : ' + [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalMinutes, 1)
'  now       : ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
Section 'who is logged on (no keyboard was touched)'
& query session 2>&1 | ForEach-Object { '  ' + $_ }
'  explorer instances: ' + @(Get-Process explorer -ErrorAction SilentlyContinue).Count
Section 'the doors'
$want = 8125,8126,8127,8128,8129,8130,8131,8133,8134,8135,8136,8137
$up = @()
foreach ($p in $want) {
  $c = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { $up += $p; '  {0,-5} UP   pid {1,-6} {2}' -f $p, $c.OwningProcess, $c.LocalAddress } else { '  {0,-5} ---' -f $p }
}
'  doors up: {0} of {1}' -f $up.Count, $want.Count
Section 'hydra processes and their session (0 = invisible)'
Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)node|electron' } | ForEach-Object {
  $cl = ($_.CommandLine -replace '\s+',' ')
  '  {0,-12} pid {1,-6} session {2,-3} {3}' -f $_.Name, $_.ProcessId, $_.SessionId, $cl.Substring(0, [Math]::Min(80, $cl.Length))
}
Section 'the miner'
$m = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)srbminer|xmrig' })
'  miner processes: {0}' -f $m.Count
$m | ForEach-Object { '    {0} pid {1} session {2} started {3:HH:mm:ss}' -f $_.Name, $_.ProcessId, $_.SessionId, $_.CreationDate }
$api = $null
for ($i = 0; $i -lt 12; $i++) {
  try { $api = Invoke-RestMethod 'http://127.0.0.1:60201/' -TimeoutSec 6; break } catch { Start-Sleep -Seconds 10 }
}
if ($api) {
  $a = @($api.algorithms)[0]
  '  api : {0}  {1:N0} H/s  A{2} R{3}' -f $a.name, $a.hashrate.'15min', $a.shares.accepted, $a.shares.rejected
  '  pool: {0}' -f $a.pool.pool
} else { '  api 60201 not answering yet' }
Section 'start evidence'
foreach ($f in 'C:\AI\miners\logs\start-guard.log','C:\AI\hydra-local\logs\relaunch.log') {
  '  --- ' + $f
  if (Test-Path $f) { Get-Content $f -Tail 6 | ForEach-Object { '      ' + ($_ -replace '\s+',' ').Trim() } } else { '      (none)' }
}
Section 'power state it must keep'
'  HiberbootEnabled: ' + (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -Name HiberbootEnabled -ErrorAction SilentlyContinue).HiberbootEnabled
$q = (& powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE) -join "`n"
'  STANDBYIDLE AC : ' + ([regex]::Match($q, 'Current AC Power Setting Index: (0x[0-9a-fA-F]+)').Groups[1].Value)
'  on AC power    : ' + ((Get-CimInstance -ClassName BatteryStatus -Namespace root\wmi -ErrorAction SilentlyContinue | Select-Object -First 1).PowerOnline)
'VERIFY DONE'
