# One-screen status of a 980 Ti render: is it alive, how fast, how much memory, how far.
$ErrorActionPreference = 'SilentlyContinue'
$log = 'C:\AI\ads\probe-980ti.log'
$out = 'C:\AI\ads\probe-980ti.webm'

$p = Get-CimInstance Win32_Process -Filter "Name = 'sd-cli.exe'"
if ($p) {
  'ALIVE: {0} process(es), pids {1}' -f @($p).Count, (($p | ForEach-Object ProcessId) -join ',')
  $cpu = (Get-Process -Id $p[0].ProcessId).CPU
  'cpu time {0:N0}s   working set {1:N0} MB' -f $cpu, ($p[0].WorkingSetSize/1MB)
} else { 'NOT RUNNING' }

$os = Get-CimInstance Win32_OperatingSystem
'RAM free {0:N1} GB of {1:N1}' -f ($os.FreePhysicalMemory/1MB), ($os.TotalVisibleMemorySize/1MB)
$g = & nvidia-smi --query-gpu=memory.used,memory.total,utilization.gpu --format=csv,noheader 2>$null
'GPU: ' + ($g -join ' | ')

if (Test-Path $log) {
  'log size {0:N0} bytes, written {1}' -f (Get-Item $log).Length, (Get-Item $log).LastWriteTime.ToString('HH:mm:ss')
  # sd.cpp writes UTF-8 here, but a Tee-Object redirect can leave UTF-16: decode both and keep the
  # one that is actually readable (fewest NULs), because grep calls the other one "binary".
  $bytes = [System.IO.File]::ReadAllBytes($log)
  $u8 = [System.Text.Encoding]::UTF8.GetString($bytes)
  $u16 = [System.Text.Encoding]::Unicode.GetString($bytes)
  $text = if (([regex]::Matches($u16, "[\x20-\x7E]").Count) -gt ([regex]::Matches($u8, "[\x20-\x7E]").Count)) { $u16 } else { $u8 }
  $lines = $text -split "`r?`n" | Where-Object { $_ -match '\S' } | Select-Object -Last 14
  '--- log tail'
  $lines | ForEach-Object { $_ } | Write-Output
} else { 'no log at ' + $log }

if (Test-Path $out) { 'OUTPUT {0:N0} KB, {1}' -f ((Get-Item $out).Length/1KB), (Get-Item $out).LastWriteTime.ToString('HH:mm:ss') }
else { 'no output file yet' }
