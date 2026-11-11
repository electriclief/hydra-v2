$ErrorActionPreference = 'Continue'
foreach ($f in 'C:\AI\logs\clean-1650.txt', 'C:\AI\logs\clean-1050Ti.txt', 'C:\AI\logs\clean-pooled.txt') {
  '--- ' + (Split-Path $f -Leaf)
  if (Test-Path $f) { Get-Content $f | Where-Object { $_ -match 'pp256|tg64' } | ForEach-Object { '  ' + $_.Trim() } } else { '  missing' }
}
'--- 1050 Ti low intensity'
$l = 'C:\AI\logs\solo1050-lowint.txt'
if (Test-Path $l) { Get-Content $l | Where-Object { $_ -match '(?i)h/s|error|cuda|intensity' } | Select-Object -Last 6 | ForEach-Object { '  ' + $_ } } else { '  missing' }
