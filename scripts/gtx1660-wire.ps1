# gtx-1660 wiring: make it a node that comes back by itself as Hydra + mining + a visible wall.
# Its three gaps, measured: Echidna had no node_modules (npm install running), node.json had no standby block so Hydra
# never owned the miner, and there was no Hydra startup entry (doors came up only because they were raised over ssh).
$ErrorActionPreference = 'Continue'
$root = 'C:\AI\hydra-local'
$nj = Join-Path $root 'module\Menu\data\node.json'
function Section($t) { '' ; '=== ' + $t }

Section '1. standby block: Hydra must own the miner, not coexist with it'
$j = Get-Content $nj -Raw | ConvertFrom-Json
if (-not $j.standby) {
  $unminer = 'C:\Users\user\AppData\Local\Programs\unMiner\unMiner.exe'
  '  unMiner present: ' + (Test-Path $unminer)
  $j | Add-Member -NotePropertyName standby -NotePropertyValue ([pscustomobject]@{
    label  = 'pearl mining (GTX 1660 SUPER)'
    after  = 1800
    pinned = $false
    start  = [pscustomobject]@{ command = $unminer; args = @(); cwd = (Split-Path $unminer -Parent); via = 'direct' }
    stop   = [pscustomobject]@{ processes = @('SRBMiner-MULTI-380', 'unMiner') }
    verify = [pscustomobject]@{ processes = @('SRBMiner-MULTI-380'); timeoutS = 120 }
    note   = 'Wired 2026-11-10. unMiner owns the GPU (SRBMiner-MULTI-380, algorithm pearl, api 60131); Hydra starts it and the guard keeps it as the idle owner. after=1800 is the operator 30-minute quiet rule.'
  })
  $j | ConvertTo-Json -Depth 6 | Set-Content $nj -Encoding UTF8
  '  standby block written'
} else {
  '  standby block already present: ' + ($j.standby.label)
}

Section '2. Hydra on the login (Explorer, not a scheduled task)'
$startup = [Environment]::GetFolderPath('Startup')
$sh = New-Object -ComObject WScript.Shell
$relaunch = Join-Path $root 'relaunch-hydra.cmd'
'  relaunch-hydra.cmd: ' + (Test-Path $relaunch)
if (Test-Path $relaunch) {
  $s = $sh.CreateShortcut((Join-Path $startup 'Hydra V2.lnk'))
  $s.TargetPath = $relaunch
  $s.WorkingDirectory = $root
  $s.WindowStyle = 7
  $s.Save()
  '  wrote Hydra V2.lnk'
}

Section '3. the wall, on the miner this node actually runs'
$wall = Join-Path $root 'scripts\miner-wall.ps1'
'  wall script: ' + (Test-Path $wall)
if (Test-Path $wall) {
  $s2 = $sh.CreateShortcut((Join-Path $startup 'Miner Wall.lnk'))
  $s2.TargetPath = 'C:\Windows\System32\conhost.exe'
  $s2.Arguments = 'powershell.exe -NoProfile -NoExit -ExecutionPolicy Bypass -File "' + $wall + '" -ApiBase http://127.0.0.1:60131/'
  $s2.WorkingDirectory = $root
  $s2.WindowStyle = 1
  $s2.Save()
  '  wrote Miner Wall.lnk -> api 60131'
}

Section '4. keep the screen useful: no lock, no sleep, screen off after 30 min'
$d = 'HKCU:\Control Panel\Desktop'
Set-ItemProperty $d -Name 'ScreenSaveActive' -Value '0' -Force
Set-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -Name 'NoLockScreen' -Value 1 -Force -ErrorAction SilentlyContinue
& powercfg /setacvalueindex SCHEME_CURRENT SUB_VIDEO VIDEOCONLOCK 0 2>&1 | Out-Null
& powercfg /setdcvalueindex SCHEME_CURRENT SUB_VIDEO VIDEOCONLOCK 0 2>&1 | Out-Null
& powercfg /setacvalueindex SCHEME_CURRENT SUB_VIDEO VIDEOIDLE 1800 2>&1 | Out-Null
& powercfg /change standby-timeout-ac 0 2>&1 | Out-Null
& powercfg /change hibernate-timeout-ac 0 2>&1 | Out-Null
& powercfg /setactive SCHEME_CURRENT 2>&1 | Out-Null
'  applied'

Section '5. state after wiring'
Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -match 'hydra' } | ForEach-Object { '  task {0} {1}' -f $_.TaskName, $_.State }
Get-ChildItem $startup | ForEach-Object { '  startup: ' + $_.Name }
'  echo AUTOADMIN=' + (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon').AutoAdminLogon + ' PASSWORDSET=' + [bool](Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon').DefaultPassword
'GTX1660 WIRE DONE'
