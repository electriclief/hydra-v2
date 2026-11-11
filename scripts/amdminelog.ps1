$ErrorActionPreference = 'Continue'
$log = 'C:\AI\logs\fourcard-mine.txt'
'--- every GPU0 line'
if (Test-Path $log) { Get-Content $log | Where-Object { $_ -match 'GPU0' } | Select-Object -Last 8 | ForEach-Object { '  ' + $_ } }
'--- opencl / amd / error lines'
if (Test-Path $log) { Get-Content $log | Where-Object { $_ -match '(?i)opencl|amd|error|not supported|kernel' } | Select-Object -Last 10 | ForEach-Object { '  ' + $_ } }
'--- head of log (init order)'
if (Test-Path $log) { Get-Content $log | Select-Object -First 18 | ForEach-Object { '  ' + $_ } }
