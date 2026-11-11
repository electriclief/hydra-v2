$ErrorActionPreference = 'Continue'
$node = 'C:\Program Files\nodejs\node.exe'
function Section($t) { '' ; '=== ' + $t }
Section 'raise Mirror (Core is already up on 8136)'
if (-not (Get-NetTCPConnection -State Listen -LocalPort 8137 -ErrorAction SilentlyContinue)) {
  $p = Start-Process -FilePath $node -ArgumentList @('src/main.js','--port','8137','--host','0.0.0.0') -WorkingDirectory 'C:\AI\hydra-local\module\Mirror' -RedirectStandardOutput 'C:\AI\hydra-local\logs\mirror-try.out' -RedirectStandardError 'C:\AI\hydra-local\logs\mirror-try.err' -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 12
  '  pid {0}  exited {1}  listening {2}' -f $p.Id, $p.HasExited, [bool](Get-NetTCPConnection -State Listen -LocalPort 8137 -ErrorAction SilentlyContinue)
  if (Test-Path 'C:\AI\hydra-local\logs\mirror-try.out') { Get-Content 'C:\AI\hydra-local\logs\mirror-try.out' -Tail 5 | ForEach-Object { '  out| ' + ($_ -replace '\s+',' ').Trim() } }
  if (Test-Path 'C:\AI\hydra-local\logs\mirror-try.err') { Get-Content 'C:\AI\hydra-local\logs\mirror-try.err' -Tail 5 | ForEach-Object { '  err! ' + ($_ -replace '\s+',' ').Trim() } }
} else { '  Mirror already listening' }
Section 'the doors that matter'
foreach ($p in 8125,8127,8133,8136,8137) {
  $c = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { '  {0} UP pid {1}' -f $p, $c.OwningProcess } else { '  {0} ---' -f $p }
}
Section 'what it publishes (Core -> State)'
try { $s = Invoke-RestMethod 'http://127.0.0.1:8127/api/state?prefix=node.1660' -TimeoutSec 6; '  entries: ' + @($s.entries).Count; @($s.entries) | Select-Object -First 4 | ForEach-Object { '    ' + $_.path } } catch { '  state door not answering' }
'1660 MIRROR DONE'
