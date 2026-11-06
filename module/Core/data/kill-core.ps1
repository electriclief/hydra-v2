# Kill every stray Core process, whatever path it was started with. Leaves the Hydra doors alone.
$targets = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine -match 'Core[\\/]src[\\/]main\.js' }

if (-not $targets) { Write-Output "no Core processes found" }
foreach ($p in $targets) {
  Write-Output ("killing pid " + $p.ProcessId)
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 1
$left = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine -match 'Core[\\/]src[\\/]main\.js' }
Write-Output ("remaining: " + @($left).Count)
