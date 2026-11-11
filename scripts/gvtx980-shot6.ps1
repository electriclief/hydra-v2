$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$ps = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$png = 'C:\AI\reports\gvtx980-screen.png'
$probe = 'C:\AI\reports\window-probe.txt'
$probeScript = 'C:\AI\hydra-local\scripts\shot-probe.ps1'

Section '1. does the wall own a real window now?'
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { ([string]$_.CommandLine) -match 'miner-wall' } | ForEach-Object {
  $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
  '  pid {0} session {1} handle {2} title "{3}"' -f $_.ProcessId, $_.SessionId, $p.MainWindowHandle, $p.MainWindowTitle
}

Section '2. probe + capture from inside the console session'
Remove-Item $png, $probe -Force -ErrorAction SilentlyContinue
@'
$out = @()
$out += 'session ' + (Get-Process -Id $PID).SessionId
try {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
  $bmp.Save('C:\AI\reports\gvtx980-screen.png', [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  $out += 'capture ok ' + (Get-Item 'C:\AI\reports\gvtx980-screen.png').Length
} catch { $out += 'capture failed: ' + $_.Exception.Message }
$wins = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { $_.ProcessName + ' :: ' + $_.MainWindowTitle })
$out += 'windows(' + $wins.Count + '): ' + ($wins -join ' | ')
Set-Content -Path 'C:\AI\reports\window-probe.txt' -Value $out -Encoding UTF8
'@ | Set-Content -Path $probeScript -Encoding UTF8

$t = 'gvtx980-shot6'
schtasks /Delete /TN $t /F 2>&1 | Out-Null
$a = New-ScheduledTaskAction -Execute $ps -Argument ('-NoProfile -ExecutionPolicy Bypass -File ' + $probeScript)
$pr = New-ScheduledTaskPrincipal -UserId 'User' -LogonType Interactive
Register-ScheduledTask -TaskName $t -Action $a -Principal $pr -Force | Out-Null
Start-ScheduledTask -TaskName $t
for ($i = 1; $i -le 15; $i++) { if (Test-Path $probe) { break }; Start-Sleep -Seconds 2 }
'  png: ' + $(if (Test-Path $png) { (Get-Item $png).Length.ToString() + ' B' } else { 'MISSING' })
if (Test-Path $probe) { Get-Content $probe | ForEach-Object { '  ' + $_ } } else { '  probe missing' }
Get-ScheduledTaskInfo -TaskName $t | ForEach-Object { '  task result ' + $_.LastTaskResult }

Section '3. numbers for the report'
try { $r = Invoke-RestMethod 'http://127.0.0.1:61235/' -TimeoutSec 6; $g = @($r.Algorithms)[0]; '  {0} {1:N3} MH/s A{2} R{3} up {4} min' -f $g.Algorithm, $g.Total_Performance, $g.Total_Accepted, $g.Total_Rejected, [int]($r.Session.Uptime/60) } catch { '  api silent' }
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=temperature.gpu,power.draw,utilization.gpu --format=csv,noheader
'GVTX980 SHOT6 DONE'
