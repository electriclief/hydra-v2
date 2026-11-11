# Windows' own reliability counters are thin on an SSD. smartmontools gives the wear counters that actually predict
# flash failure: SSD_Life_Left, NAND writes in GiB, reallocated, pending, CRC. Install it silently, then read.
$ErrorActionPreference = 'Continue'
$sc = 'C:\Program Files\smartmontools\bin\smartctl.exe'
if (-not (Test-Path $sc)) {
  $setup = Join-Path $env:USERPROFILE 'sm-setup.exe'
  if (-not (Test-Path $setup) -or (Get-Item $setup).Length -lt 1MB) {
    & curl.exe -L --fail --max-time 180 -o $setup 'https://master.dl.sourceforge.net/project/smartmontools/smartmontools/7.5/smartmontools-7.5.win32-setup.exe?viasf=1' 2>&1 | Out-Null
  }
  '  installer: {0:N0} bytes' -f (Get-Item $setup -ErrorAction SilentlyContinue).Length
  if ((Get-Item $setup -ErrorAction SilentlyContinue).Length -gt 1MB) {
    Start-Process -FilePath $setup -ArgumentList '/S' -Wait
    Start-Sleep -Seconds 3
  } else { '  installer looks like the interstitial HTML page, not the binary'; 'SMART DONE'; exit }
}
'  smartctl: ' + (& $sc --version | Select-Object -First 1)

'== scan'
& $sc --scan-open 2>&1 | ForEach-Object { '  ' + $_ }

'== identity and health'
$out = & $sc -i -H -d sat /dev/sda 2>&1
if ($LASTEXITCODE -ne 0 -or ($out -join ' ') -notmatch 'Device Model') { $out = & $sc -i -H -d auto /dev/sda 2>&1 }
$out | Select-String -Pattern 'Device Model|Serial Number|Firmware|User Capacity|Rotation Rate|SMART overall-health|SMART Health' | ForEach-Object { '  ' + $_.Line.Trim() }

'== wear and error counters'
$attr = & $sc -A -d sat /dev/sda 2>&1
if (($attr -join ' ') -notmatch 'ATTRIBUTE_NAME') { $attr = & $sc -A -d auto /dev/sda 2>&1 }
$attr | Select-String -Pattern '^\s*(3|5|9|12|167|168|169|171|172|173|175|177|179|181|182|183|184|187|190|192|194|196|197|198|199|202|231|232|233|234|241|242)\s' | ForEach-Object { '  ' + ($_.Line -replace '\s+',' ').Trim() }

'== self-test (short)'
& $sc -t short -d sat /dev/sda 2>&1 | Select-Object -First 2 | ForEach-Object { '  ' + $_.Trim() }
'SMART DONE'
