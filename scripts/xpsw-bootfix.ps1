# Why the clean boot failed, and the two fixes.
#
# MEASURED: boot 19:15:07 -> autologon worked (console session 1, Active, user) -> Startup ran the launcher at
# 19:17:05 -> "[doors] ProcessWrapper down - starting it hidden" -> "boot failed: ProcessWrapper never answered on
# 8125" -> no doors, no Electron, no miner. ProcessWrapper itself is fine: started by hand it binds 8125 in seconds.
# The app waited a hard-coded 25 s, which a cold Windows boot cannot meet while Defender first-scans a 105 MB
# node.exe. That timeout is now 120 s in main.cjs, and this script removes the cause as well.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$root = 'C:\AI\hydra-local'

Section '1. Defender exclusions, so a cold boot does not scan the runtime it is about to run'
try {
  Add-MpPreference -ExclusionPath $root, 'C:\AI\miners', 'C:\AI\logs' -ErrorAction Stop
  Add-MpPreference -ExclusionProcess 'node.exe', 'electron.exe', 'lolMiner.exe' -ErrorAction Stop
  '  exclusions added'
} catch { '  could not add exclusions: ' + $_.Exception.Message }
$p = Get-MpPreference
'  paths    : ' + (@($p.ExclusionPath) -join ' | ')
'  processes: ' + (@($p.ExclusionProcess) -join ' | ')

Section '2. the patched app (25 s -> 120 s) lands here'
$src = 'C:\Users\User\main.cjs'
$dst = Join-Path $root 'module\Basic_App\electron\main.cjs'
if (Test-Path $src) {
  Copy-Item $dst ($dst + '.bak-preboot') -Force -ErrorAction SilentlyContinue
  Copy-Item $src $dst -Force
  $hit = Select-String -Path $dst -Pattern '120000' -SimpleMatch
  '  deployed; 120000 present: ' + [bool]$hit
} else { '  patched main.cjs not shipped - still 25 s' }

Section '3. one wall instance, not a stack of them'
$walls = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'miner-wall' -and $_.Name -eq 'powershell.exe' })
'  powershell running miner-wall: ' + $walls.Count
$walls | Select-Object -Skip 1 | ForEach-Object { '    stopping duplicate pid ' + $_.ProcessId; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Section '4. what is on disk and armed for the next boot'
foreach ($f in 'relaunch-xpsw.cmd','open-wall.cmd','miner-wall.ps1') { '  scripts\{0}: {1}' -f $f, (Test-Path (Join-Path $root ('scripts\' + $f))) }
Get-ChildItem ([Environment]::GetFolderPath('Startup')) | ForEach-Object { '  startup: ' + $_.Name }
$wl = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
'  autologon {0}/{1} user {2}' -f $wl.AutoAdminLogon, $wl.ForceAutoLogon, $wl.DefaultUserName
'XPSW FIX APPLIED'
