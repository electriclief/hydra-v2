$ErrorActionPreference = 'Continue'
# Screenshot the operator's own screen, from their interactive session, and list the visible windows with titles.
# Run through schtasks /it so it lands in session 1 - a screenshot from session 0 is a black rectangle.
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$sig = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WShot {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int L, T, R, B; }
}
'@
Add-Type -TypeDefinition $sig -WarningAction SilentlyContinue

$list = New-Object System.Collections.ArrayList
$cb = [WShot+EnumProc]{
  param($h, $p)
  $len = [WShot]::GetWindowTextLength($h)
  if ($len -gt 0 -and [WShot]::IsWindowVisible($h)) {
    $sb = New-Object System.Text.StringBuilder ($len + 2)
    [void][WShot]::GetWindowText($h, $sb, $sb.Capacity)
    $r = New-Object WShot+RECT
    [void][WShot]::GetWindowRect($h, [ref]$r)
    [void]$list.Add([pscustomobject]@{ Title = $sb.ToString(); X = $r.L; Y = $r.T; W = ($r.R - $r.L); H = ($r.B - $r.T) })
  }
  return $true
}
[void][WShot]::EnumWindows($cb, [IntPtr]::Zero)

$list | ForEach-Object { '  {0,-28} at {1},{2}  {3}x{4}' -f $_.Title.Substring(0, [Math]::Min(28, $_.Title.Length)), $_.X, $_.Y, $_.W, $_.H }

$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
$out = 'C:\AI\reports\screen-now.png'
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
'saved ' + $out + '  (' + $b.Width + 'x' + $b.Height + ')'
