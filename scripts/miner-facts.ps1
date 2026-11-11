# What a miner on this box is actually doing, read from the miner itself: its command line (which pool,
# which worker, which algorithm) and its own API or, failing that, the share lines in its log.
$ErrorActionPreference = 'SilentlyContinue'

'== miner processes'
$procs = Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'SRBMiner|xmrig|lolminer|unMiner|TeamRed' }
foreach ($p in $procs) {
  '{0,-28} pid {1,-7} {2}' -f $p.Name, $p.ProcessId, $p.CommandLine
}

'== api ports seen on this box'
$ports = Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -ge 60000 -and $_.LocalPort -le 60199 } |
         Select-Object -ExpandProperty LocalPort -Unique
if ($ports) { 'listening: ' + ($ports -join ', ') } else { 'none in 60000-60199' }

foreach ($port in $ports) {
  '-- http://127.0.0.1:{0}/' -f $port
  try {
    $r = Invoke-WebRequest -Uri ('http://127.0.0.1:' + $port + '/') -TimeoutSec 5 -UseBasicParsing
    $txt = $r.Content
    if (-not $txt) { 'empty body' } else {
      try {
        $j = $txt | ConvertFrom-Json
        $a = @($j.algorithms)[0]
        if ($a) {
          'algo      ' + $a.name
          'rate 1min ' + $a.hashrate.'1min'
          'shares    ' + ($a.shares | ConvertTo-Json -Compress)
          'pool      ' + ($a.pool.pool)
          'uptime    ' + $a.pool.time_connected
        } else { $txt.Substring(0, [Math]::Min(300, $txt.Length)) }
      } catch { $txt.Substring(0, [Math]::Min(300, $txt.Length)) }
    }
  } catch { 'no answer: ' + $_.Exception.Message }
}

'== share lines in any miner log under C:\AI'
$logs = Get-ChildItem 'C:\AI' -Recurse -Include '*.log', '*.txt' -Depth 3 -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match 'miner|srb|xmrig|unminer|guard' -and $_.Length -gt 0 }
foreach ($l in $logs) {
  $hits = Select-String -Path $l.FullName -Pattern 'share|accepted|ACCEPTED' -ErrorAction SilentlyContinue | Select-Object -Last 3
  if ($hits) {
    '-- ' + $l.FullName + '  (' + [math]::Round($l.Length/1KB,1) + ' KB)'
    $hits | ForEach-Object { '   ' + $_.Line }
  }
}
