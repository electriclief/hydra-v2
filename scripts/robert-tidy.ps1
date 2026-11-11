# Tidy robert's screen and reload the walls with the fixed script.
#   1. stop the old wall + the leftover console my screenshot task left open
#   2. raise the GPU wall again (start-wall-row.ps1) and the CPU wall (start-cpu-wall-row.ps1)
#   3. lay the three windows out again
$ErrorActionPreference = 'Continue'
$root = 'C:\AI\hydra-local'

'== stopping stale wall / screenshot processes'
$kill = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'miner-wall\.ps1|shot-screen\.ps1|cpu-wall\.ps1' }
foreach ($p in $kill) {
  '{0} {1} <- stopping' -f $p.ProcessId, $p.Name
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

'== raising the GPU wall'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\start-wall-row.ps1')
Start-Sleep -Seconds 6

'== raising the CPU wall'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\start-cpu-wall-row.ps1')
Start-Sleep -Seconds 4

'== placing windows'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\place-windows.ps1')

'== windows now on this desktop'
Add-Type -AssemblyName System.Windows.Forms
Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object ProcessName, MainWindowTitle |
  Format-Table -AutoSize | Out-String | Write-Output
