# Is this box mining, and is anything visible doing it?
#   - miner processes with their command lines (the flags a manager assembled)
#   - NVIDIA state (util, memory, temperature) when nvidia-smi exists
#   - miner API ports that are listening, so a page can read shares
#   - scheduled tasks and startup entries with a miner name in them
param([int]$LogLines = 6)

$ErrorActionPreference = 'Continue'
'host: {0}   {1}' -f $env:COMPUTERNAME, (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')

'--- miner processes'
$procs = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)srb|lol|xmrig|miner|pearl|unmine' })
if ($procs.Count) {
  foreach ($p in $procs) {
    '  {0} (pid {1})' -f $p.Name, $p.ProcessId
    if ($p.CommandLine) { '     ' + ($p.CommandLine -replace '\s+', ' ').Substring(0, [math]::Min(300, ($p.CommandLine -replace '\s+', ' ').Length)) }
    '     started: {0}   path: {1}' -f $p.CreationDate, $p.ExecutablePath
  }
} else { '  none' }

'--- gpu state'
$smi = 'C:\Windows\System32\nvidia-smi.exe'
if (-not (Test-Path $smi)) { $smi = 'nvidia-smi.exe' }
try {
  $q = & $smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader 2>&1
  if ($LASTEXITCODE -eq 0 -and $q) { $q | ForEach-Object { '  ' + $_ } }
  else { '  nvidia-smi: ' + (($q | Select-Object -First 2) -join ' | ') }
} catch { '  nvidia-smi not available: ' + $_.Exception.Message }

'--- miner api ports listening'
$ports = @(61234, 60201, 60131, 21550, 3333, 4068, 18080, 8080)
$listen = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ports -contains $_.LocalPort })
if ($listen.Count) {
  foreach ($l in $listen) {
    $owner = (Get-Process -Id $l.OwningProcess -ErrorAction SilentlyContinue).ProcessName
    '  {0}:{1}  owner {2} (pid {3})' -f $l.LocalAddress, $l.LocalPort, $owner, $l.OwningProcess
  }
} else { '  none of the usual miner ports are listening' }

'--- scheduled tasks / startup entries mentioning a miner'
$tasks = @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -match '(?i)miner|srb|lol|xmrig|hydra|standby' })
if ($tasks.Count) { $tasks | Select-Object TaskName, State | Format-Table -AutoSize | Out-String -Width 100 | Write-Host } else { '  no scheduled task' }
$run = @(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue |
  Select-Object -Property * -ExcludeProperty PS* | ForEach-Object { $_.PSObject.Properties } |
  Where-Object { $_.Value -match '(?i)miner|srb|lol|xmrig|hydra' })
if ($run.Count) { $run | ForEach-Object { '  Run: {0} = {1}' -f $_.Name, $_.Value } } else { '  no Run entry' }

'--- recent miner logs'
$logs = @(Get-ChildItem 'C:\AI' -Recurse -Include '*.log', '*.txt' -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match '(?i)miner|srb|lol|wall|share' } | Sort-Object LastWriteTime -Descending | Select-Object -First 2)
if ($logs.Count) {
  foreach ($l in $logs) {
    '  {0}  (modified {1})' -f $l.FullName, $l.LastWriteTime
    Get-Content $l.FullName -Tail $LogLines -ErrorAction SilentlyContinue | ForEach-Object { '     ' + $_ }
  }
} else { '  no miner log found under C:\AI' }
