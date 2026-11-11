# Make the mining task survive a reboot, and confirm the supervisor is writing share lines.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }

Section 'add a logon trigger so a reboot resumes mining by itself'
$t = Get-ScheduledTask -TaskName 'HydraMine1'
$logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:COMPUTERNAME\User"
$logon.Delay = 'PT30S'
Register-ScheduledTask -TaskName 'HydraMine1' -Action $t.Actions -Principal $t.Principal -Settings $t.Settings -Trigger $logon -Force | Out-Null
$now = Get-ScheduledTask -TaskName 'HydraMine1'
'  state={0}  triggers={1}  principal={2}/{3}' -f $now.State, ($now.Triggers | ForEach-Object { $_.CimClass.CimClassName }), $now.Principal.UserId, $now.Principal.LogonType

Section 'supervisor share lines today'
$w = 'C:\AI\logs\supervisor.txt'
if (Test-Path $w) {
  $lines = Get-Content $w -Encoding UTF8 -ErrorAction SilentlyContinue
  $good = @($lines | Where-Object { $_ -match '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}' })
  '  clean lines: {0} of {1}' -f $good.Count, $lines.Count
  $good | Select-Object -Last 6 | ForEach-Object { '  ' + $_ }
}

Section 'is it still hashing'
try {
  $a = Invoke-RestMethod 'http://127.0.0.1:60220/' -TimeoutSec 10
  $alg = @($a.algorithms)[0]
  '  {0} H/s   A{1} R{2}' -f $alg.hashrate.'15min', $alg.shares.accepted, $alg.shares.rejected
} catch { '  api: ' + $_.Exception.Message }
'TRIGGER DONE'
