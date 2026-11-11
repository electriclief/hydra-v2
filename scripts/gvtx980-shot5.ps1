# Last attempt at a picture from this box. CopyFromScreen fails inside an *elevated* task with "The handle is invalid"
# even though the console session is Active and LogonUI is not running — the difference from XPSW, where the same task
# worked, is the RunLevel. Try it limited, try waking the display first, and if both fail, prove "visible" the other way:
# ask the process in session 1 what its own window title is.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$ps = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$png = 'C:\AI\reports\gvtx980-screen.png'
$probe = 'C:\AI\reports\window-title.txt'

Section '1. capture task with a LIMITED token'
Remove-Item $png, $probe -Force -ErrorAction SilentlyContinue
$t = 'gvtx980-shot5'
schtasks /Delete /TN $t /F 2>&1 | Out-Null
$script = @'
$png = 'C:\AI\reports\gvtx980-screen.png'
$probe = 'C:\AI\reports\window-title.txt'
$out = @()
$out += 'session ' + (Get-Process -Id $PID).SessionId
try { Add-Type -AssemblyName System.Windows.Forms, System.Drawing; $b = [System.Windows.Forms.SystemInformation]::VirtualScreen; $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height; $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size); $bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose(); $out += 'capture ok ' + (Get-Item $png).Length } catch { $out += 'capture failed: ' + $_.Exception.Message }
try { $hp = Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { $_.ProcessName + ' :: ' + $_.MainWindowTitle }; $out += ('windows: ' + ($hp -join ' | ')) } catch { $out += 'window probe failed: ' + $_.Exception.Message }
Set-Content -Path $probe -Value $out -Encoding UTF8
'@
Set-Content -Path 'C:\AI\reports\shot-probe.ps1' -Value $script -Encoding UTF8
$a = New-ScheduledTaskAction -Execute $ps -Argument '-NoProfile -ExecutionPolicy Bypass -File C:\AI\reports\shot-probe.ps1'
$pr = New-ScheduledTaskPrincipal -UserId 'User' -LogonType Interactive
Register-ScheduledTask -TaskName $t -Action $a -Principal $pr -Force | Out-Null
Start-ScheduledTask -TaskName $t
for ($i = 1; $i -le 12; $i++) { if (Test-Path $probe) { break }; Start-Sleep -Seconds 2 }
'  png: ' + $(if (Test-Path $png) { (Get-Item $png).Length.ToString() + ' B' } else { 'MISSING' })
if (Test-Path $probe) { Get-Content $probe | ForEach-Object { '  probe: ' + $_ } } else { '  probe file missing (task may not have run in the session)' }
Get-ScheduledTaskInfo -TaskName $t | ForEach-Object { '  task result ' + $_.LastTaskResult }

Section '2. wake the display, leave it awake, try once more'
& powercfg /change monitor-timeout-ac 0 2>&1 | Out-Null
& powercfg /change monitor-timeout-dc 0 2>&1 | Out-Null
$wake = @'
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point 400, 300
'@
Set-Content -Path 'C:\AI\reports\wake.ps1' -Value $wake -Encoding UTF8
$t2 = 'gvtx980-wake'
schtasks /Delete /TN $t2 /F 2>&1 | Out-Null
$a2 = New-ScheduledTaskAction -Execute $ps -Argument '-NoProfile -ExecutionPolicy Bypass -File C:\AI\reports\wake.ps1'
Register-ScheduledTask -TaskName $t2 -Action $a2 -Principal $pr -Force | Out-Null
Start-ScheduledTask -TaskName $t2
Start-Sleep -Seconds 6
schtasks /Run /TN $t 2>&1 | Out-Null
for ($i = 1; $i -le 12; $i++) { if ((Test-Path $png) -and (Get-Item $png).Length -gt 40000) { break }; Start-Sleep -Seconds 2 }
'  png now: ' + $(if (Test-Path $png) { (Get-Item $png).Length.ToString() + ' B' } else { 'MISSING' })
if (Test-Path $probe) { Get-Content $probe | ForEach-Object { '  probe: ' + $_ } }

Section '3. the honest fallback: the wall says what it is showing'
$wallp = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { ([string]$_.CommandLine) -match 'miner-wall' })
$wallp | ForEach-Object { '  wall pid {0} session {1}' -f $_.ProcessId, $_.SessionId }
$gp = @($wallp | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue })
$gp | ForEach-Object { '  window title: "' + $_.MainWindowTitle + '"  handle ' + $_.MainWindowHandle + '  responding ' + $_.Responding }
'GVTX980 SHOT5 DONE'
