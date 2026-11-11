$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section 'doors the shelf raises (from shelf-headless.mjs)'
$s = Get-Content 'C:\AI\hydra-local\shelf-headless.mjs' -Raw
[regex]::Matches($s, "(?m)^\s*(\w+)\s*:\s*\{[^}]*?(?:port|PORT)\s*:\s*(\d+)") | ForEach-Object { '  {0,-14} {1}' -f $_.Groups[1].Value, $_.Groups[2].Value } | Select-Object -First 20
'  --- raw door list lines'
Select-String -Path 'C:\AI\hydra-local\shelf-headless.mjs' -Pattern 'Event_Handler|event|8126|sessiondiary|thoughts|8134|8135' | Select-Object -First 10 | ForEach-Object { '    ' + $_.LineNumber + ': ' + ($_.Line.Trim()) }
Section 'modules present on this box'
Get-ChildItem 'C:\AI\hydra-local\module' -Directory | ForEach-Object { '  ' + $_.Name }
Section 'is Event_Handler runnable'
$eh = 'C:\AI\hydra-local\module\Event_Handler'
if (Test-Path $eh) {
  Get-ChildItem $eh | ForEach-Object { '  ' + $_.Name }
  '  data/palette.json: ' + (Test-Path (Join-Path $eh 'data\palette.json'))
} else { '  no Event_Handler module here' }
Section 'miner now'
$api = try { Invoke-RestMethod 'http://127.0.0.1:60201/' -TimeoutSec 6 } catch { $null }
if ($api) { $a = @($api.algorithms)[0]; '  {0}  {1:N0} H/s  A{2} R{3}  pool {4}' -f $a.name, $a.hashrate.'15min', $a.shares.accepted, $a.shares.rejected, $a.pool.pool } else { '  api down' }
'  miners: ' + @(Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue).Count
Section 'relaunch.log (did the Startup shortcut speak)'
$r = 'C:\AI\hydra-local\logs\relaunch.log'
if (Test-Path $r) { '  size ' + (Get-Item $r).Length + ' B'; Get-Content $r -Tail 8 | ForEach-Object { '    ' + ($_ -replace '\s+',' ').Trim() } }
'JIMS GAPS DONE'
