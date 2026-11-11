Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$out = 'C:\AI\logs\screen.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
$msg = "captured {0}x{1} -> {2} ({3:N0} bytes) at {4}" -f $b.Width, $b.Height, $out, (Get-Item $out).Length, (Get-Date).ToString('HH:mm:ss')
$msg | Out-File 'C:\AI\logs\screen.log' -Encoding UTF8
$msg
