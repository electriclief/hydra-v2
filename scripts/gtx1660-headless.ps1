$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section 'what the install actually has'
foreach ($f in 'shelf-headless.mjs','relaunch-hydra.cmd','open-hydra-window.cmd','shelf-service.cmd') {
  $p = Join-Path 'C:\AI\hydra-local' $f
  '  {0,-24} {1}' -f $f, (Test-Path $p)
}
'  any electron.exe under C:\AI or hermes:'
@('C:\AI\hydra-local\tools\electron\electron.exe') + @(Get-ChildItem "$env:LOCALAPPDATA\hermes" -Recurse -Filter 'electron.exe' -Depth 5 -ErrorAction SilentlyContinue | Select-Object -First 3 -ExpandProperty FullName) |
  ForEach-Object { '    ' + $_ + '  ' + (Test-Path $_) }
Section 'raise it headless (no electron needed for the doors)'
$shelf = 'C:\AI\hydra-local\shelf-headless.mjs'
if (-not (Test-Path $shelf)) { '  no shelf-headless.mjs on this box - cannot raise headless'; '1660 HEADLESS DONE'; exit }
$cmd = 'cmd.exe /c "set HYDRA_NODE=C:\Program Files\nodejs\node.exe&& set HYDRA_HOST=0.0.0.0&& set HYDRA_MODULE_ROOT=C:\AI\hydra-local\module&& cd /d C:\AI\hydra-local&& \"C:\Program Files\nodejs\node.exe\" shelf-headless.mjs >> C:\AI\hydra-local\logs\shelf.log 2>&1"'
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
Section 'shelf log'
if (Test-Path 'C:\AI\hydra-local\logs\shelf.log') { Get-Content 'C:\AI\hydra-local\logs\shelf.log' -Tail 8 | ForEach-Object { '  ' + ($_ -replace '\s+',' ').Trim() } } else { '  (no log)' }
'1660 HEADLESS DONE'
