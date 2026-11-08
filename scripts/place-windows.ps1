# =====================================================================================
#  PLACE-WINDOWS - put the app and the two share walls where the operator can read all three.
#
#  Measured problem this fixes: both walls opened at their default size in the same corner and covered each other and the
#  app. The app is the thing you DRIVE; the walls are the things you GLANCE at, so the app keeps the left half and the two
#  walls stack on the right - GPU on top (it earns), CPU underneath (it uses what is left).
#
#  Runs in the operator's interactive session (schtasks /it) with no visible console.
# =====================================================================================
$ErrorActionPreference = 'Continue'
$sig = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinPlace {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int t, bool r);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
'@
Add-Type -TypeDefinition $sig -WarningAction SilentlyContinue
Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue

function Get-Windows {
  $list = New-Object System.Collections.ArrayList
  $cb = [WinPlace+EnumProc]{
    param($h, $p)
    $len = [WinPlace]::GetWindowTextLength($h)
    if ($len -gt 0 -and [WinPlace]::IsWindowVisible($h)) {
      $sb = New-Object System.Text.StringBuilder ($len + 2)
      [void][WinPlace]::GetWindowText($h, $sb, $sb.Capacity)
      [void]$list.Add([pscustomobject]@{ H = $h; Title = $sb.ToString() })
    }
    return $true
  }
  [void][WinPlace]::EnumWindows($cb, [IntPtr]::Zero)
  return $list
}

$screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$W = $screen.Width
$H = $screen.Height
$leftW = [int]($W * 0.52)
$rightX = $leftW + 8
$rightW = $W - $rightX - 8
$halfH = [int](($H - 24) / 2)

$all = Get-Windows
$app = $all | Where-Object { $_.Title -eq 'Hydra V2' } | Select-Object -First 1
$gpu = $all | Where-Object { $_.Title -match 'robert - mining' } | Select-Object -First 1
$cpu = $all | Where-Object { $_.Title -match 'robert - cpu' } | Select-Object -First 1

foreach ($pair in @(
    @{ win = $app; x = 0; y = 0; w = $leftW; h = $H - 8; label = 'Hydra V2' },
    @{ win = $gpu; x = $rightX; y = 0; w = $rightW; h = $halfH; label = 'robert - mining' },
    @{ win = $cpu; x = $rightX; y = $halfH + 4; w = $rightW; h = $halfH; label = 'robert - cpu' }
  )) {
  if (-not $pair.win) { 'MISSING: ' + $pair.label; continue }
  [void][WinPlace]::ShowWindow($pair.win.H, 9)   # SW_RESTORE
  [void][WinPlace]::MoveWindow($pair.win.H, $pair.x, $pair.y, $pair.w, $pair.h, $true)
  'placed {0,-18} at {1},{2}  {3}x{4}' -f $pair.label, $pair.x, $pair.y, $pair.w, $pair.h
}
if ($app) { [void][WinPlace]::SetForegroundWindow($app.H) }
