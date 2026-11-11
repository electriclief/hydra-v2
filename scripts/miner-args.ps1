# Print the full command line of the running GPU miner, one argument per line, so it can be replicated.
$p = Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)srbminer' } | Select-Object -First 1
if (-not $p) { 'no SRBMiner process'; return }
'name : ' + $p.Name
'pid  : ' + $p.ProcessId
'path : ' + $p.ExecutablePath
'version: ' + (Get-Item $p.ExecutablePath).VersionInfo.FileVersion
'--- arguments, one per line'
$cl = $p.CommandLine
($cl -replace '"?[A-Z]:\\[^ ]*SRBMiner-MULTI\.exe"?', '') -split '\s+(?=--)' | ForEach-Object { '  ' + $_.Trim() }
