# XPSW boot contract: power on -> log itself in -> Hydra raises its doors and shows its window -> the miner starts
# -> a console window on the desk prints every share the pool accepts. Nothing here is a hidden background process:
# two Startup shortcuts, both visible, both closable.
$ErrorActionPreference = 'Continue'
$root = 'C:\AI\hydra-local'
function Section($t) { '' ; '=== ' + $t }

$ref = 'xpsw'
$nj = Join-Path $root 'module\Menu\data\node.json'
if (Test-Path $nj) { try { $ref = (Get-Content $nj -Raw | ConvertFrom-Json).ref } catch { } }

Section '1. the share window, on the Startup folder (session 1, visible, has a close button)'
$startup = [Environment]::GetFolderPath('Startup')
$ws = New-Object -ComObject WScript.Shell
$wallLnk = Join-Path $startup 'Miner Wall.lnk'
$s = $ws.CreateShortcut($wallLnk)
$s.TargetPath = 'C:\Windows\System32\cmd.exe'
$s.Arguments = '/c "C:\AI\hydra-local\scripts\open-wall.cmd"'
$s.WorkingDirectory = $root
$s.Description = 'Mining proof: every accepted share, as it lands'
$s.Save()
'  ' + $wallLnk + '  exists=' + (Test-Path $wallLnk)
Get-ChildItem $startup | ForEach-Object { '    startup: ' + $_.Name }

Section '2. what the wall will read (the instance layer, not a literal)'
try {
  $j = Get-Content $nj -Raw | ConvertFrom-Json
  '  name    : ' + $j.name
  '  label   : ' + $j.standby.label
  '  apiPort : ' + ((@($j.standby.start.args) -join ' ') -replace '^.*--apiport\s+([0-9]+).*$', '$1')
} catch { '  node.json unreadable: ' + $_.Exception.Message }

Section '3. autologon (a window needs a console session; the doors do not)'
$wl = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
'  AutoAdminLogon={0} ForceAutoLogon={1} user={2} domain={3} password set={4}' -f $wl.AutoAdminLogon, $wl.ForceAutoLogon, $wl.DefaultUserName, $wl.DefaultDomainName, [bool]$wl.DefaultPassword

Section '4. prove a screenshot is possible from session 1 later'
$capture = Join-Path $root 'scripts\capture-screen.ps1'
@'
param([string]$Out = "C:\AI\reports\screen.png")
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
New-Item -ItemType Directory -Force -Path (Split-Path $Out) | Out-Null
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
"captured $Out"
'@ | Set-Content -Path $capture -Encoding UTF8
'  wrote ' + $capture

Section '5. state right now'
foreach ($p in 8125,8127,8133,8136,8137) {
  $c = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { '  {0} UP pid {1}' -f $p, $c.OwningProcess } else { '  {0} ---' -f $p }
}
'  lolMiner: ' + @(Get-Process lolMiner -ErrorAction SilentlyContinue).Count
Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)electron|conhost|powershell' } | ForEach-Object {
  $cl = ($_.CommandLine -replace '\s+',' ')
  '  {0,-14} pid {1,-6} session {2,-3} {3}' -f $_.Name, $_.ProcessId, $_.SessionId, $cl.Substring(0,[Math]::Min(60,$cl.Length)) }
'XPSW BOOT WIRED'
