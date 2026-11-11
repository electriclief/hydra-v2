$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }

Section 'does the miner have a visible window'
Get-Process lolMiner -ErrorAction SilentlyContinue | ForEach-Object { '  pid {0} sess {1} title="{2}" hwnd={3}' -f $_.Id, $_.SessionId, $_.MainWindowTitle, $_.MainWindowHandle }

Section 'ProcessWrapper config on this node'
$pw = 'C:\AI\hydra-local\module\ProcessWrapper'
if (Test-Path $pw) {
  Get-ChildItem $pw -Recurse -Include '*.json', '*.yaml', '*.yml' -ErrorAction SilentlyContinue | Select-Object -First 12 | ForEach-Object { '  {0}  ({1:N0} B)' -f $_.FullName, $_.Length }
} else { '  no ProcessWrapper module dir' }

Section 'PW process table via its API'
foreach ($p in 8125) {
  try {
    $r = Invoke-RestMethod "http://127.0.0.1:$p/api/processes" -TimeoutSec 6
    $rows = @($r.processes)
    if (-not $rows.Count) { $rows = @($r) }
    foreach ($x in $rows) { '  {0,-16} state={1,-10} pid={2,-7} cmd={3}' -f $x.name, $x.state, $x.pid, (($x.command + ' ' + ($x.args -join ' ')).Trim()) }
  } catch { '  api 8125: ' + $_.Exception.Message }
}

Section 'stray scripts still running from Temp'
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match '\\Windows\\Temp' } | ForEach-Object {
  '  pid {0} :: {1}' -f $_.ProcessId, ($_.CommandLine -replace '\s+', ' ')
}
'PWCHECK DONE'
