# =====================================================================================
#  START-CPU-WALL-ROW - the CPU miner's window, as a ProcessWrapper row, next to the GPU wall.
#
#  Same shape as start-wall-row.ps1 and for the same measured reason: powershell.exe or conhost.exe alone exits 0 with no
#  window (Node's detached spawn strips the console), so the row is `cmd /c start /wait <title> conhost powershell`, which
#  always builds a real console and keeps cmd holding it. One row, one window, one close button.
# =====================================================================================
param(
  [string]$Root = 'C:\AI\hydra-local',
  [int]$WaitSeconds = 300,
  [switch]$NoPlace
)
$ErrorActionPreference = 'Continue'
$log = Join-Path $Root 'logs\cpu-wall-row.log'
if (-not (Test-Path (Split-Path $log))) { New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null }
function Say([string]$m) { try { Add-Content $log ((Get-Date).ToString('HH:mm:ss') + '  ' + $m) } catch { } }

Say 'cpu-wall-row: start'
$up = $false
for ($i = 0; $i -lt $WaitSeconds; $i += 3) {
  try { if ((Invoke-RestMethod 'http://127.0.0.1:8125/health' -TimeoutSec 3).ok) { $up = $true; break } } catch { }
  Start-Sleep -Seconds 3
}
$wall = Join-Path $Root 'scripts\cpu-wall.ps1'

if (-not $up) {
  Say 'cpu-wall-row: no wrapper - plain window so the CPU panel is never missing'
  Start-Process -FilePath 'conhost.exe' -ArgumentList 'powershell.exe', '-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', $wall
  return
}
Say ("cpu-wall-row: wrapper up after ~" + $i + " s")

$rows = (Invoke-RestMethod 'http://127.0.0.1:8125/api/processes' -TimeoutSec 5).processes
$existing = $rows | Where-Object { $_.name -eq 'cpu-wall' -and ($_.life -eq 'running' -or $_.life -eq 'starting') } | Select-Object -First 1
if ($existing) {
  Say ('cpu-wall-row: already running as ' + $existing.id + ' pid ' + $existing.pid)
} else {
  $body = @{
    name       = 'cpu-wall'
    command    = 'C:\WINDOWS\System32\cmd.exe'
    args       = @('/c', 'start', '/wait', 'robert - cpu', 'conhost.exe', 'powershell.exe', '-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', $wall)
    cwd        = $Root
    tag        = 'console'
    isolation  = 'supervised'
    hideWindow = $false
  } | ConvertTo-Json -Depth 5
  try {
    $r = Invoke-RestMethod 'http://127.0.0.1:8125/api/processes' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 20
    Say ('cpu-wall-row: raised ' + $r.process.id + ' pid ' + $r.process.pid)
  } catch {
    Say ('cpu-wall-row: wrapper refused: ' + $_.Exception.Message)
  }
  Start-Sleep -Seconds 8
  $after = (Invoke-RestMethod 'http://127.0.0.1:8125/api/processes' -TimeoutSec 5).processes | Where-Object { $_.name -eq 'cpu-wall' } | Select-Object -First 1
  if (-not $after -or $after.life -ne 'running') {
    Say 'cpu-wall-row: the row did not stay up - plain window instead'
    Start-Process -FilePath 'conhost.exe' -ArgumentList 'powershell.exe', '-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', $wall
  } else {
    Say ('cpu-wall-row: row is running, pid ' + $after.pid)
  }
}

# place it: bottom half of the screen, beside/below the GPU wall, without touching the app window
if (-not $NoPlace) {
  $sig = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class CpuWallPlace {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int t, bool r);
}
'@
  try { Add-Type -TypeDefinition $sig -WarningAction SilentlyContinue } catch { }
  $handle = [IntPtr]::Zero
  for ($i = 0; $i -lt 20; $i++) {
    $list = New-Object System.Collections.ArrayList
    $cb = [CpuWallPlace+EnumProc]{
      param($h, $p)
      $len = [CpuWallPlace]::GetWindowTextLength($h)
      if ($len -gt 0 -and [CpuWallPlace]::IsWindowVisible($h)) {
        $sb = New-Object System.Text.StringBuilder ($len + 2)
        [void][CpuWallPlace]::GetWindowText($h, $sb, $sb.Capacity)
        if ($sb.ToString() -match 'robert - cpu') { [void]$list.Add($h) }
      }
      return $true
    }
    [void][CpuWallPlace]::EnumWindows($cb, [IntPtr]::Zero)
    if ($list.Count -gt 0) { $handle = $list[0]; break }
    Start-Sleep -Seconds 2
  }
  if ($handle -ne [IntPtr]::Zero) {
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen
    try { Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue } catch { }
    $w = 900; $h = 420
    [void][CpuWallPlace]::MoveWindow($handle, 20, 600, $w, $h, $true)
    Say 'cpu-wall-row: window placed'
  } else {
    Say 'cpu-wall-row: no window handle found to place (it may have opened after this gave up)'
  }
}
Say 'cpu-wall-row: done'
