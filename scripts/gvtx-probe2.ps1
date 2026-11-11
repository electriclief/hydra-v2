$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }

Section 'every miner process and who spawned it'
Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)srb|lol|xmrig|powershell|cmd' } | ForEach-Object {
  $par = $null
  try { $par = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.ParentProcessId)" -ErrorAction SilentlyContinue).Name } catch { }
  '  pid {0,-6} sess {1}  parent {2,-16} {3}' -f $_.ProcessId, $_.SessionId, $par, (($_.Name + ' ' + ($_.CommandLine -replace '\s+', ' ')).Substring(0, [Math]::Min(150, ($_.Name + ' ' + ($_.CommandLine -replace '\s+', ' ')).Length)))
}

Section 'the two echidna-mine tasks'
foreach ($n in 'echidna-mine', 'echidna-mine-gpu', 'Hydra-Miner') {
  $t = Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue
  if ($t) {
    '  --- {0}  state={1}  principal={2}/{3}' -f $n, $t.State, $t.Principal.UserId, $t.Principal.LogonType
    $t.Actions | ForEach-Object { '      exec: {0} {1}' -f $_.Execute, $_.Arguments }
    $t.Triggers | ForEach-Object { '      trigger: {0}' -f $_.CimClass.CimClassName }
  }
}

Section 'lolMiner API on 61235'
try {
  $a = Invoke-RestMethod 'http://127.0.0.1:61235/' -TimeoutSec 8
  '  algo: ' + $a.Session.Algorithm
  '  rate: ' + $a.Algorithms[0].Total_Performance + ' x' + $a.Algorithms[0].Performance_Factor
  '  accepted: ' + $a.Algorithms[0].Total_Accepted + '  rejected: ' + $a.Algorithms[0].Total_Rejected
  '  uptime: ' + $a.Session.Uptime
} catch { '  api: ' + $_.Exception.Message }

Section 'log tail'
if (Test-Path 'C:\AI\logs\lolmine.log') { Get-Content 'C:\AI\logs\lolmine.log' -Tail 8 | ForEach-Object { '  ' + $_ } }
'GVTX2 DONE'
