param([switch]$Stop)

# Who owns the GPU/RAM before a render: the miner, any watchdog, and what the last run actually said.
$ErrorActionPreference = 'SilentlyContinue'

'== xmrig / miner processes'
Get-CimInstance Win32_Process -Filter "Name = 'xmrig.exe'" |
  Select-Object ProcessId, ParentProcessId, @{n='MB';e={[math]::Round($_.WorkingSetSize/1MB,0)}}, CommandLine |
  Format-List | Out-String | Write-Output

'== who is the parent'
foreach ($p in (Get-CimInstance Win32_Process -Filter "Name = 'xmrig.exe'")) {
  $parent = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $p.ParentProcessId)
  'xmrig {0} <- parent {1} {2}' -f $p.ProcessId, $p.ParentProcessId, $parent.Name
  '  parent cmd: ' + $parent.CommandLine
}

'== process wrapper rows (8125)'
try {
  $rows = Invoke-RestMethod -Uri 'http://127.0.0.1:8125/api/processes' -TimeoutSec 4
  'rows: ' + @($rows.processes).Count
  $rows.processes | Where-Object { $_.name -match 'miner|xmrig|guard|standby' } |
    Select-Object id, name, life, pid | Format-Table -AutoSize | Out-String | Write-Output
} catch { 'no ProcessWrapper on this node (' + $_.Exception.Message + ')' }

'== scheduled tasks that could bring it back'
$t = Get-ScheduledTask | Where-Object { $_.TaskName -match 'miner|hydra|standby|guard' }
if ($t) { $t | Select-Object TaskName, State | Format-Table -AutoSize | Out-String | Write-Output } else { 'none matched' }

'== what the last render said (decoded, last 12 lines each)'
foreach ($f in 'wan.log', 'wan2.log', 'wan-dl.log') {
  $p = Join-Path 'C:\AI\ads' $f
  if (Test-Path $p) {
    '--- ' + $f
    $bytes = [System.IO.File]::ReadAllBytes($p)
    # UTF-16LE shows as "B i n a r y" in grep and as nulls here; strip them and decode as text
    $text = [System.Text.Encoding]::Unicode.GetString($bytes)
    if (($text -split "`n" | Where-Object { $_.Trim() }).Count -lt 2) { $text = [System.Text.Encoding]::UTF8.GetString($bytes) }
    ($text -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -Last 12) | Write-Output
  }
}

if ($Stop) {
  '== stopping the miner'
  $killed = 0
  foreach ($p in (Get-CimInstance Win32_Process -Filter "Name = 'xmrig.exe'")) {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    if (-not (Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue)) { $killed++ }
  }
  'stopped {0} xmrig process(es)' -f $killed
  Start-Sleep -Seconds 3
  $os = Get-CimInstance Win32_OperatingSystem
  'RAM free now: {0:N1} GB' -f ($os.FreePhysicalMemory/1MB)
}
