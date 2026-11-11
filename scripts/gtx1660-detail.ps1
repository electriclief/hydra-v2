$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section 'the miner in full'
$m = Get-CimInstance Win32_Process -Filter "Name='SRBMiner-MULTI-380.exe'" | Select-Object -First 1
if ($m) {
  '  pid ' + $m.ProcessId + ' started ' + $m.CreationDate
  '  cmdline: ' + ($m.CommandLine -replace '\s+',' ')
  $port = (Get-NetTCPConnection -OwningProcess $m.ProcessId -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).LocalPort
  '  api port: ' + $port
  if ($port) {
    try { $j = Invoke-RestMethod ("http://127.0.0.1:$port/") -TimeoutSec 6; $a = @($j.algorithms)[0]; '  algo {0}  {1:N0} H/s  A{2} R{3}' -f $a.name, $a.hashrate.'15min', $a.shares.accepted, $a.shares.rejected } catch { '  api not answering: ' + $_.Exception.Message }
  }
} else { '  no SRBMiner-380 process' }
Section 'the llm'
$l = Get-CimInstance Win32_Process -Filter "Name='llama-server.exe'" | Select-Object -First 1
if ($l) {
  $lp = ($l.CommandLine -replace '\s+',' ')
  '  pid ' + $l.ProcessId + ' started ' + $l.CreationDate
  '  cmdline: ' + $lp.Substring(0,[Math]::Min(240,$lp.Length))
  foreach ($p in 8080,8081) { $c = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue; if ($c) { '  listening :' + $p } }
}
Section 'hermes on this box'
'  gateway 8642: ' + [bool](Get-NetTCPConnection -State Listen -LocalPort 8642 -ErrorAction SilentlyContinue)
'  hermes config: ' + (Test-Path "$env:LOCALAPPDATA\hermes\config.yaml")
Section 'the hydra shelf: installed but not running'
'  module folders: ' + ((Get-ChildItem 'C:\AI\hydra-local\module' -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name) -join ', ')
'  relaunch-hydra.cmd electron line:'
Select-String -Path 'C:\AI\hydra-local\relaunch-hydra.cmd' -Pattern '^set "ELECTRON=' | ForEach-Object { '    ' + $_.Line.Trim() }
'  tools here: ' + ((Get-ChildItem 'C:\AI\hydra-local\tools' -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name) -join ', ')
'  logs\relaunch.log tail:'
if (Test-Path 'C:\AI\hydra-local\logs\relaunch.log') { Get-Content 'C:\AI\hydra-local\logs\relaunch.log' -Tail 4 | ForEach-Object { '    ' + ($_ -replace '\s+',' ').Trim() } } else { '    (no log)' }
'1660 DETAIL DONE'
