# Restart one ProcessWrapper row by name, reusing the exact command/args/cwd it is running now.
#   -Name core-8136
# The replacement is raised through the same door, so the table still owns it (no loose process, no second copy).
param(
  [Parameter(Mandatory = $true)][string]$Name,
  [int]$WaitSeconds = 6
)
$ErrorActionPreference = 'Continue'
$pw = 'http://127.0.0.1:8125'

$list = (Invoke-RestMethod "$pw/api/processes" -TimeoutSec 8).processes
$row = @($list | Where-Object { $_.name -eq $Name -and $_.life -in @('running', 'starting') }) | Select-Object -First 1
if (-not $row) { "no live row named $Name"; return }

$spec = @{
  name    = $row.name
  tag     = $row.tag
  command = $row.command
  args    = @($row.args)
  cwd     = $row.cwd
}
if ($row.isolation) { $spec.isolation = $row.isolation }
"restarting {0} ({1}) -> {2} {3}" -f $row.name, $row.id, $row.command, ($row.args -join ' ')

try { Invoke-RestMethod -Uri "$pw/api/processes/$($row.id)/kill" -Method Post -ContentType 'application/json' -Body '{"force":true}' -TimeoutSec 10 | Out-Null } catch { '  kill: ' + $_.Exception.Message }
Start-Sleep -Seconds 2

$body = $spec | ConvertTo-Json -Depth 5 -Compress
$r = Invoke-RestMethod -Uri "$pw/api/processes" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 15
'raised: ' + $r.process.id
Start-Sleep -Seconds $WaitSeconds

$list2 = (Invoke-RestMethod "$pw/api/processes" -TimeoutSec 8).processes
$list2 | Where-Object { $_.name -eq $Name } | Select-Object name, life, id | Format-Table -AutoSize | Out-String
