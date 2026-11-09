# Reload the standby guard on this node after shipping a new standby-guard.ps1.
# Kill the old row, then raise the new one through ProcessWrapper with the same spec the app's WATCHDOG_TABLE uses,
# so the replacement is a supervised row (visible in the Process tab) and not a loose process.
$ErrorActionPreference = 'Continue'
$pw = 'http://127.0.0.1:8125'
$root = 'C:\AI\hydra-local'
$script = Join-Path $root 'scripts\standby-guard.ps1'

if (-not (Test-Path $script)) { throw 'missing ' + $script }

$list = (Invoke-RestMethod "$pw/api/processes" -TimeoutSec 8).processes
$old = @($list | Where-Object { $_.name -eq 'standby-guard' -and $_.life -in @('running', 'starting') })
foreach ($o in $old) {
  'killing old guard row ' + $o.id
  try { Invoke-RestMethod -Uri "$pw/api/processes/$($o.id)/kill" -Method Post -ContentType 'application/json' -Body '{"force":true}' -TimeoutSec 10 | Out-Null } catch { '  kill failed: ' + $_.Exception.Message }
}
Start-Sleep -Seconds 2

$body = @{
  name  = 'standby-guard'
  tag   = 'watch'
  command = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
  args  = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $script)
  cwd   = (Join-Path $root 'scripts')
} | ConvertTo-Json -Depth 4 -Compress
$r = Invoke-RestMethod -Uri "$pw/api/processes" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 15
'raised: ' + $r.process.id + '  life=' + $r.process.life

Start-Sleep -Seconds 8
$list2 = (Invoke-RestMethod "$pw/api/processes" -TimeoutSec 8).processes
$list2 | Where-Object { $_.name -in @('standby-guard', 'standby-miner') } | Select-Object name, life, id | Format-Table -AutoSize | Out-String
'--- guard.log tail'
Get-Content (Join-Path $root 'data\standby\guard.log') -Tail 10
