# watch-report.ps1 -- show the drain watch's small logs by hand: today's events, then
# the three most recent earlier days, then where the expected list and the raw
# sampler streams live. Run it via watch-report.cmd at the module root.
$dir = Join-Path $PSScriptRoot "..\data\watch"
if (-not (Test-Path $dir)) {
  Write-Host ("no watch logs yet -- " + $dir)
  exit 0
}
$todayName = "watch-" + (Get-Date -Format yyyyMMdd) + ".log"
$today = Join-Path $dir $todayName
Write-Host ("== today (" + $todayName + ") ==")
if (Test-Path $today) { Get-Content $today } else { Write-Host "(no events today)" }
$older = @(Get-ChildItem $dir -Filter "watch-*.log" | Where-Object { $_.Name -ne $todayName } | Sort-Object Name -Descending | Select-Object -First 3)
foreach ($f in $older) {
  Write-Host ""
  Write-Host ("== " + $f.Name + " (last 40 lines) ==")
  Get-Content $f.FullName | Select-Object -Last 40
}
Write-Host ""
Write-Host ("expected list: " + (Join-Path $dir "expected.txt"))
Write-Host ("raw samples:   " + (Join-Path $PSScriptRoot "..\data\streams") + "  (the system-watch-*.log life file)")
