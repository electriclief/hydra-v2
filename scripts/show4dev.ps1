$ErrorActionPreference = 'Continue'
'=== 3b on 4 devices, tail'
$p1 = 'C:\AI\logs\4dev-3b-4dev.txt'
if (Test-Path $p1) { Get-Content $p1 | Select-Object -Last 14 | ForEach-Object { '  ' + $_ } } else { '  missing' }
'=== 7b on 4 devices, tail'
$p2 = 'C:\AI\logs\4dev-7b-4dev.txt'
if (Test-Path $p2) { Get-Content $p2 | Select-Object -Last 10 | ForEach-Object { '  ' + $_ } } else { '  missing' }
'=== any leftover bench processes'
@(Get-Process llama-bench -ErrorAction SilentlyContinue).Count
