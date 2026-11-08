# =====================================================================================
#  START-WALL-ROW - raise the share wall as a ProcessWrapper row, on the screen.
#
#  Why a row and not a loose window: the operator rule is that nothing runs on this box as an
#  invisible background process. A row appears in the Process table with a close button, and
#  - with hideWindow:false and supervised isolation - it ALSO has its own console window you can
#  read from across the room. One process, one table, one window.
#
#  Isolation matters here and is not a detail: "in-loop" pipes the child's stdio, and Windows then
#  gives a console app NO console window at all, so hideWindow has nothing to un-hide. "supervised"
#  detaches it with stdio ignored, which is what makes the window real.
#
#  Run at logon from Startup (hidden launcher): waits for the wrapper, registers the row, places
#  the windows, exits. Restarting it is harmless - it adopts an existing row.
# =====================================================================================
param(
  [string]$Root = 'C:\AI\hydra-local',
  [int]$WaitSeconds = 300,
  [switch]$NoPlace
)

$ErrorActionPreference = 'Continue'
$log = Join-Path $Root 'logs\wall-row.log'
function Say([string]$m) {
  $line = (Get-Date).ToString('HH:mm:ss') + '  ' + $m
  try { Add-Content -Path $log -Value $line -ErrorAction Stop } catch { }
}
if (-not (Test-Path (Split-Path $log))) { New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null }

Say 'wall-row: start'

# ---- 1. wait for the wrapper. The app raises its doors at logon, and this may beat it by seconds.
$up = $false
for ($i = 0; $i -lt $WaitSeconds; $i += 3) {
  try {
    $h = Invoke-RestMethod -Uri 'http://127.0.0.1:8125/health' -TimeoutSec 3
    if ($h.ok) { $up = $true; break }
  } catch { }
  Start-Sleep -Seconds 3
}
if (-not $up) {
  Say 'wall-row: the wrapper never answered on 8125 - starting a plain window instead so the wall is never missing'
  Start-Process -FilePath 'conhost.exe' -ArgumentList 'powershell.exe', '-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $Root 'scripts\miner-wall.ps1')
  exit 0
}
Say ("wall-row: wrapper up after ~" + $i + " s")

# ---- 2. adopt or raise
$rows = (Invoke-RestMethod -Uri 'http://127.0.0.1:8125/api/processes' -TimeoutSec 5).processes
$wall = $rows | Where-Object { $_.name -eq 'miner-wall' -and ($_.life -eq 'running' -or $_.life -eq 'starting') } | Select-Object -First 1
if ($wall) {
  Say ('wall-row: already running as ' + $wall.id + ' pid ' + $wall.pid)
} else {
  $body = @{
    name      = 'miner-wall'
    # conhost.exe, not powershell.exe: a console-subsystem child launched with stdio ignored does NOT reliably get a
    # console of its own (measured: the row exited 0 with no window). conhost always creates one, and powershell then
    # inherits it - so the wall is a window you can read, and still a row in the table with a close button.
    # cmd /c start /wait: Node's detached spawn on Windows strips the console (DETACHED_PROCESS, no
    # CREATE_NEW_CONSOLE), so conhost had nothing to attach to and the row exited 0 with no window - twice. `start`
    # always builds a real console window, and /wait keeps cmd holding it, so the ROW is the thing you kill and the
    # window is the thing you read. One row, one window, one close button.
    command   = 'C:\WINDOWS\System32\cmd.exe'
    args      = @('/c', 'start', '/wait', 'robert - mining', 'conhost.exe', 'powershell.exe', '-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $Root 'scripts\miner-wall.ps1'))
    cwd       = $Root
    tag       = 'console'
    isolation = 'supervised'   # detached + stdio ignored: the row outlives the wrapper's request
    hideWindow = $false        # ask for the window explicitly
  } | ConvertTo-Json -Depth 5
  try {
    $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8125/api/processes' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 20
    Say ('wall-row: raised ' + $r.process.id + ' pid ' + $r.process.pid)
  } catch {
    Say ('wall-row: the wrapper refused the row: ' + $_.Exception.Message)
  }
  Start-Sleep -Seconds 8
  $after = (Invoke-RestMethod -Uri 'http://127.0.0.1:8125/api/processes' -TimeoutSec 5).processes | Where-Object { $_.name -eq 'miner-wall' } | Select-Object -First 1
  if (-not $after -or $after.life -ne 'running') {
    Say ('wall-row: the row did not stay up (' + $(if ($after) { $after.life } else { 'missing' }) + ') - starting a plain window so the wall is never absent')
    Start-Process -FilePath 'conhost.exe' -ArgumentList 'powershell.exe', '-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $Root 'scripts\miner-wall.ps1')
  } else {
    Say ('wall-row: row is running, pid ' + $after.pid)
  }
}

# ---- 3. place the windows: app on top, wall underneath, both fully visible on 1920x1080
if (-not $NoPlace) {
  $sig = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WallPlace {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int t, bool r);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
}
'@
  try { Add-Type -TypeDefinition $sig -WarningAction SilentlyContinue } catch { }

  function Get-Windows {
    $list = New-Object System.Collections.ArrayList
    $cb = [WallPlace+EnumProc]{
      param($h, $p)
      $len = [WallPlace]::GetWindowTextLength($h)
      if ($len -gt 0) {
        $sb = New-Object System.Text.StringBuilder ($len + 2)
        [void][WallPlace]::GetWindowText($h, $sb, $sb.Capacity)
        [void]$list.Add([pscustomobject]@{ Handle = $h; Title = $sb.ToString(); Visible = [WallPlace]::IsWindowVisible($h) })
      }
      return $true
    }
    [void][WallPlace]::EnumWindows($cb, [IntPtr]::Zero)
    return $list
  }

  # wait for both windows to exist (the app may still be booting when the row comes up)
  $w = $null; $a = $null
  for ($i = 0; $i -lt 30; $i++) {
    $all = Get-Windows
    $w = $all | Where-Object { $_.Title -match 'robert - mining' } | Select-Object -First 1
    $a = $all | Where-Object { $_.Title -eq 'Hydra V2' } | Select-Object -First 1
    if ($w -and $a) { break }
    Start-Sleep -Seconds 2
  }
  if ($a) { [void][WallPlace]::MoveWindow($a.Handle, 16, 10, 1180, 700, $true); Say 'placed the app at 16,10 1180x700' }
  if ($w) { [void][WallPlace]::MoveWindow($w.Handle, 16, 726, 1180, 330, $true); [void][WallPlace]::ShowWindow($w.Handle, 9); Say 'placed the wall at 16,726 1180x330' }
  if (-not $w) { Say 'wall-row: no wall window found to place (it may have started later)' }
}

Say 'wall-row: done'
