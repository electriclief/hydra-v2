# Install smartmontools silently and prove it can read this box's disks.
# The installer is NSIS: /S is silent, /D sets the directory (must be last, unquoted).
$ErrorActionPreference = 'Continue'
$setup = 'C:\Users\User\sm-setup.exe'
if (-not (Test-Path $setup)) { throw "no installer at $setup" }

$p = Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru
'installer exit: ' + $p.ExitCode
Start-Sleep -Seconds 3

$bins = @('C:\Program Files\smartmontools\bin', 'C:\Program Files\smartmontools\bin64', 'C:\Program Files (x86)\smartmontools\bin')
$bin = $null
foreach ($b in $bins) { if (Test-Path (Join-Path $b 'smartctl.exe')) { $bin = $b; break } }
if (-not $bin) { throw 'smartctl.exe not found after install' }
'bin: ' + $bin
$ctl = Join-Path $bin 'smartctl.exe'

'== version'
& $ctl --version 2>&1 | Select-Object -First 2

'== what the box has (auto scan)'
& $ctl --scan-open 2>&1 | Write-Output

'== every physical disk, with the generic SAT layer (what a USB bridge needs)'
foreach ($n in (Get-Disk | Where-Object { $_.BusType -in @('SATA','USB','NVMe') } | Select-Object -ExpandProperty Number)) {
  '--- PhysicalDrive{0}' -f $n
  & $ctl -d sat -i "/dev/pd{0}" -d "sat" 2>&1 | Select-Object -First 6
  & $ctl -i "/dev/sd{0}" 2>&1 | Select-Object -First 4
}
