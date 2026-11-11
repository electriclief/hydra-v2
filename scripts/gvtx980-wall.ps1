# Two things to fix, both mine: the "Mining wall" startup shortcut I removed was the thing putting the share window on
# the screen (it was a conhost stub that launched miner-wall.ps1), and the screenshot task keeps producing nothing on
# this box, so "visible" has not been proved here yet.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$wall = 'C:\AI\hydra-local\scripts\miner-wall.ps1'
$ps = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'

Section '1. the wall script we are supposed to be running'
'  {0} exists: {1}' -f $wall, (Test-Path $wall)
if (Test-Path $wall) {
  Get-Content $wall -TotalCount 25 | ForEach-Object { '    ' + $_ }
}

Section '2. the node.json the wall reads'
$nj = 'C:\AI\hydra-local\module\Menu\data\node.json'
if (Test-Path $nj) { '  ref=' + (Get-Content $nj -Raw | ConvertFrom-Json).ref + '  standby.start.args port=' + (((Get-Content $nj -Raw | ConvertFrom-Json).standby.start.args) -join ' ') }

Section '3. put the wall back on the login'
$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'Miner Wall.lnk'
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($lnk)
$s.TargetPath = $ps
$s.Arguments = '-NoProfile -NoExit -ExecutionPolicy Bypass -File "' + $wall + '"'
$s.WorkingDirectory = 'C:\AI\hydra-local'
$s.WindowStyle = 1
$s.Description = 'Hydra miner wall - live shares'
$s.Save()
'  wrote ' + $lnk

Section '4. start it now, in the console session'
$t = 'gvtx980-wall-now'
schtasks /Delete /TN $t /F 2>&1 | Out-Null
$a = New-ScheduledTaskAction -Execute $ps -Argument ('-NoProfile -NoExit -ExecutionPolicy Bypass -File "' + $wall + '"') -WorkingDirectory 'C:\AI\hydra-local'
$p = New-ScheduledTaskPrincipal -UserId 'User' -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName $t -Action $a -Principal $p -Force | Out-Null
Start-ScheduledTask -TaskName $t
Start-Sleep -Seconds 12
$w = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { ([string]$_.CommandLine) -match 'miner-wall' })
'  wall processes: ' + $w.Count
$w | ForEach-Object { '    pid {0} session {1}' -f $_.ProcessId, $_.SessionId }

Section '5. screenshot, with the error kept this time'
$png = 'C:\AI\reports\gvtx980-screen.png'
$log = 'C:\AI\reports\capture.log'
Remove-Item $png, $log -Force -ErrorAction SilentlyContinue
$t2 = 'gvtx980-shot3'
schtasks /Delete /TN $t2 /F 2>&1 | Out-Null
$a2 = New-ScheduledTaskAction -Execute $ps -Argument ('-NoProfile -ExecutionPolicy Bypass -File C:\AI\hydra-local\scripts\capture-screen.ps1 -Out ' + $png)
$p2 = New-ScheduledTaskPrincipal -UserId 'User' -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName $t2 -Action $a2 -Principal $p2 -Force | Out-Null
Start-ScheduledTask -TaskName $t2
for ($i = 1; $i -le 12; $i++) { if ((Test-Path $png) -and (Get-Item $png).Length -gt 40000) { break }; Start-Sleep -Seconds 2 }
'  png: ' + $(if (Test-Path $png) { (Get-Item $png).Length.ToString() + ' B' } else { 'MISSING' })
Get-ScheduledTaskInfo -TaskName $t2 | ForEach-Object { '  task result ' + $_.LastTaskResult + '  at ' + $_.LastRunTime }
if (-not (Test-Path $png)) {
  Section '5b. fallback capture, run inline'
  try {
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
    $bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    '  inline capture wrote ' + (Get-Item $png).Length + ' B'
  } catch { '  inline capture failed: ' + $_.Exception.Message }
}

Section '6. miner as the wall will see it'
try { $a3 = Invoke-RestMethod 'http://127.0.0.1:61235/' -TimeoutSec 6; $g3 = @($a3.Algorithms)[0]; '  {0} {1:N3} MH/s A{2} R{3}' -f $g3.Algorithm, $g3.Total_Performance, $g3.Total_Accepted, $g3.Total_Rejected } catch { '  api 61235 silent' }
'GVTX980 WALL DONE'
