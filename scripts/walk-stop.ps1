# stop the diagnostic walk - the question it was answering is no longer asked
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -like '*walk-debug*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; "stopped powershell $($_.ProcessId)" }
Get-Process robocopy -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.Id -Force; "stopped robocopy $($_.Id)" }
'walk stopped'
