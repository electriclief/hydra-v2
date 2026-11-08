$ErrorActionPreference = 'Continue'
# What xmrig actually answers, field by field, so the readers can be corrected against the wire rather than guessed.
$port = 60131
try { $raw = Invoke-WebRequest ("http://127.0.0.1:$port/2/summary") -TimeoutSec 5 -UseBasicParsing } catch { 'api not answering: ' + $_.Exception.Message; return }
$s = $raw.Content | ConvertFrom-Json
'keys at top: ' + (($s.PSObject.Properties | ForEach-Object { $_.Name }) -join ', ')
''
'hashrate type: ' + $s.hashrate.GetType().Name
'hashrate.total: ' + ($s.hashrate.total -join ' | ')
'hashrate props: ' + (($s.hashrate.PSObject.Properties | ForEach-Object { $_.Name }) -join ', ')
''
'results props: ' + (($s.results.PSObject.Properties | ForEach-Object { $_.Name }) -join ', ')
'  shares_good=' + $s.results.shares_good + '  shares_total=' + $s.results.shares_total
''
'cpu props: ' + (($s.cpu.PSObject.Properties | ForEach-Object { $_.Name }) -join ', ')
'  cpu.threads count: ' + @($s.cpu.threads).Count
'  cpu.threads: ' + ($s.cpu.threads | ForEach-Object { $_ } | Out-String).Trim()
''
'algo: ' + $s.algo + '  uptime: ' + $s.uptime + '  connection.pool: ' + $s.connection.pool
''
'the three numbers a wall needs:'
'  rate (60s)  : ' + [math]::Round([double]@($s.hashrate.total)[1], 1) + ' H/s'
'  accepted    : ' + $s.results.shares_good + ' / ' + $s.results.shares_total
'  threads used: ' + @($s.cpu.threads).Count
