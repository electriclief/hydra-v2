$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section 'can this box raise its own shelf'
$el = 'C:\Users\User\AppData\Local\hermes\node\node_modules\electron\dist\electron.exe'
$app = 'C:\AI\hydra-local\module\Basic_App\electron\main.cjs'
'  electron: ' + (Test-Path $el) + '   app: ' + (Test-Path $app)
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
'  node on PATH: ' + $node
$hn = 'C:\Users\User\AppData\Local\hermes\tools'
if (Test-Path $hn) { '  hermes tools: ' + ((Get-ChildItem $hn -Directory | Select-Object -First 6 -ExpandProperty Name) -join ', ') }
if ((Test-Path $el) -and (Test-Path $app)) {
  Section 'raise it detached'
  $env:HYDRA_NODE = if ($node) { $node } else { '' }
  $cmd = 'cmd.exe /c "C:\AI\hydra-local\relaunch-hydra.cmd"'
  $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd }
  '  returnValue=' + $r.ReturnValue + ' pid=' + $r.ProcessId
  Section 'wait for doors'
  $want = 8125,8127,8128,8131,8133,8136,8137
  for ($i = 1; $i -le 20; $i++) {
    Start-Sleep -Seconds 5
    $up = @(); foreach ($p in $want) { if (Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue) { $up += $p } }
    '  t{0,3}s  {1}/{2}  ({3})' -f ($i*5), $up.Count, $want.Count, ($up -join ',')
    if ($up.Count -ge 6) { break }
  }
  Section 'state'
  Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)node|electron' } | ForEach-Object {
    $cl = ($_.CommandLine -replace '\s+',' ')
    '  {0,-12} pid {1,-6} session {2,-3} {3}' -f $_.Name, $_.ProcessId, $_.SessionId, $cl.Substring(0,[Math]::Min(70,$cl.Length)) }
  Section 'relaunch log'
  if (Test-Path 'C:\AI\hydra-local\logs\relaunch.log') { Get-Content 'C:\AI\hydra-local\logs\relaunch.log' -Tail 5 | ForEach-Object { '  ' + ($_ -replace '\s+',' ').Trim() } } else { '  no log written' }
} else { '  cannot raise: electron or app missing' }
'1660 RAISE DONE'
