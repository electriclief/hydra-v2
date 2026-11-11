$ErrorActionPreference = 'Continue'
$png = 'C:\AI\reports\gvtx980-screen.png'
$taskName = 'gvtx980-shot'
schtasks /Delete /TN $taskName /F 2>&1 | Out-Null
Remove-Item $png -Force -ErrorAction SilentlyContinue
$act = New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
  -Argument '-NoProfile -ExecutionPolicy Bypass -File C:\AI\hydra-local\scripts\capture-screen.ps1 -Out C:\AI\reports\gvtx980-screen.png'
$pr = New-ScheduledTaskPrincipal -UserId 'User' -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $act -Principal $pr -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
for ($i = 1; $i -le 15; $i++) {
  if ((Test-Path $png) -and (Get-Item $png).Length -gt 40000) { break }
  Start-Sleep -Seconds 2
}
if (Test-Path $png) { 'png: ' + (Get-Item $png).Length + ' B' } else { 'png: MISSING' }
'GVTX980 SHOT DONE'
