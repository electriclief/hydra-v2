# One line per node, the facts that decide "does it come back as a Hydra node that mines".
$ErrorActionPreference = 'Continue'
$root = 'C:\AI\hydra-local'
$os = Get-CimInstance Win32_OperatingSystem
$wl = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
$nj = Join-Path $root 'module\Menu\data\node.json'
$ref = '?'; $port = 0
if (Test-Path $nj) {
  $j = Get-Content $nj -Raw | ConvertFrom-Json
  $ref = $j.ref
  $a = @($j.standby.start.args); $i = $a.IndexOf('--apiport')
  if ($i -ge 0) { $port = [int]$a[$i + 1] } elseif ($j.miner.apiPort) { $port = [int]$j.miner.apiPort }
}
$ports = @(8125, 8127, 8128, 8130, 8136, 8137, 8138)
$up = @($ports | Where-Object { Get-NetTCPConnection -State Listen -LocalPort $_ -ErrorAction SilentlyContinue })
$guard = 'no'
try {
  $rows = @((Invoke-RestMethod 'http://127.0.0.1:8125/api/processes' -TimeoutSec 6).processes | Where-Object { $_.life -eq 'running' })
  if ($rows.name -match 'standby-guard') { $guard = 'yes' }
  $guard = 'yes (' + (@($rows | Where-Object { $_.name -match 'standby-guard' }).Count) + ' guard, ' + (@($rows | Where-Object { $_.name -match 'standby-miner|standby-cpu' }).Count) + ' miner rows)'
} catch { $guard = 'pw down' }
$rate = 'no answer'
if ($port) {
  try {
    $a2 = Invoke-RestMethod ("http://127.0.0.1:" + $port + "/") -TimeoutSec 5
    if ($a2.Algorithms) { $g = @($a2.Algorithms)[0]; $rate = ('{0} {1:N2} MH/s A{2}' -f $g.Algorithm, $g.Total_Performance, $g.Total_Accepted) }
    elseif ($a2.algorithms) { $g = @($a2.algorithms)[0]; $h = $g.hashrate.'1min'; $rate = ('{0} {1:N0} H/s A{2}' -f $g.name, $h, $g.shares.accepted) }
  } catch { }
}
$card = 'none'
try { $c = (Invoke-RestMethod 'http://127.0.0.1:8138/api/monitor' -TimeoutSec 5).monitor.card; if ($c) { $card = '[' + $c.kind + '] ' + $c.title } } catch { $card = 'echidna silent' }
$gpu = ''
try { $gpu = ((& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=name,temperature.gpu,power.draw,utilization.gpu --format=csv,noheader 2>$null) -join ' | ') } catch { }
if (-not $gpu) { $gpu = (Get-CimInstance Win32_VideoController | Select-Object -First 1).Name }

'{0}|{1}|up {2}m|autologon {3}/{4}|doors {5}/{6}|guard {7}|miner {8}|monitor {9}|{10}' -f `
  $ref, $env:COMPUTERNAME, [int]((Get-Date) - $os.LastBootUpTime).TotalMinutes, $wl.AutoAdminLogon, $(if ($wl.DefaultPassword) { 'pwset' } else { 'nopw' }), `
  $up.Count, $ports.Count, $guard, $rate, $card, $gpu
