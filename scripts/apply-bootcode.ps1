# Write NT60 boot code to an already-built installer drive, without rebuilding it.
# Mounts the ISO only to borrow bootsect.exe, then verifies what landed on sector 0.
param(
  [Parameter(Mandatory = $true)][string]$Volume,   # drive letter of the media partition, e.g. F
  [string]$Iso = 'C:\AI\iso\tiny11_25H2.iso'
)
$ErrorActionPreference = 'Stop'

$img = Mount-DiskImage -ImagePath $Iso -PassThru
$vol = Get-Volume -DiskImage $img | Where-Object DriveLetter | Select-Object -First 1
$bootsect = Join-Path "$($vol.DriveLetter):\" 'boot\bootsect.exe'
if (-not (Test-Path -LiteralPath $bootsect)) { throw 'bootsect.exe not found on the media' }
'rewriting boot code with ' + $bootsect
& $bootsect /nt60 "$($Volume):" /mbr /force
'bootsect exit: ' + $LASTEXITCODE
Dismount-DiskImage -ImagePath $Iso | Out-Null
'dismounted'
