# Runs after the GTX 1650 is physically seated. One pass: driver, then every probe, in the order that answers questions.
#   - if the card is not on the bus, it says so and stops before touching the driver (no point installing for nothing)
#   - the driver is installed silently; the exit code is reported, not assumed
#   - then each toolchain says what IT can see - the same three commands that were empty before the card went in
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }

Section 'bus - is the card there before anything else'
# "Microsoft Basic Display Adapter" is the card with no driver - it is how a freshly seated card looks before the
# installer runs, and it must count as "the card is here", or this script aborts exactly when it is most needed.
$devs = @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object {
    $_.InstanceId -match '^PCI\\' -and $_.FriendlyName -match '(?i)nvidia|geforce|radeon|vga|3d|basic display'
  })
if ($devs.Count -eq 0) {
  '  no add-in display controller on the bus.'
  '  A card in a dead slot or on an unpowered riser shows exactly this. Stop here: reseat / power the riser.'
  'ABORT - nothing installed'
  return
}
foreach ($d in $devs) {
  '  {0}' -f $d.FriendlyName
  '     status {0}  problem {1}  {2}' -f $d.Status, $d.Problem, $d.InstanceId
}

Section 'pcie link for that card'
$one = $devs | Select-Object -First 1
foreach ($k in 'DEVPKEY_PciDevice_CurrentLinkWidth', 'DEVPKEY_PciDevice_CurrentLinkSpeed',
  'DEVPKEY_PciDevice_MaxLinkWidth', 'DEVPKEY_PciDevice_MaxLinkSpeed', 'DEVPKEY_Device_LocationInfo') {
  try {
    $p = Get-PnpDeviceProperty -InstanceId $one.InstanceId -KeyName $k -ErrorAction Stop
    '  {0,-38} {1}' -f ($k -replace 'DEVPKEY_', ''), $p.Data
  } catch { '  {0,-38} (not published)' -f ($k -replace 'DEVPKEY_', '') }
}

Section 'driver'
$nvsmi = 'C:\Windows\System32\nvidia-smi.exe'
if (Test-Path $nvsmi) {
  '  nvidia-smi already present - a driver is installed'
  & $nvsmi --query-gpu=name,driver_version,memory.total,pstate --format=csv,noheader
} else {
  $exe = 'C:\AI\tools\dl\nvidia-582.66.exe'
  if (-not (Test-Path $exe)) { '  installer MISSING at ' + $exe; }
  else {
    '  installing 582.66 silently (this takes a few minutes and the screen may flash)'
    $p = Start-Process -FilePath $exe -ArgumentList '-s', '-clean', '-noreboot' -Wait -PassThru
    '  installer exit code: ' + $p.ExitCode
    Start-Sleep -Seconds 12
    if (Test-Path $nvsmi) { & $nvsmi --query-gpu=name,driver_version,memory.total --format=csv,noheader }
    else { '  nvidia-smi still absent - driver did not land; check C:\ProgramData\NVIDIA Corporation\NVIDIA app\NvAppInstaller or run the exe by hand' }
  }
}

Section 'what each toolchain sees now'
$out = 'C:\AI\logs\after-card.txt'
Remove-Item $out -Force -ErrorAction SilentlyContinue
'--- llama.cpp --list-devices' | Add-Content $out
if (Test-Path 'C:\AI\llama\llama-cli.exe') { & 'C:\AI\llama\llama-cli.exe' --list-devices *>> $out }
'--- SRBMiner --list-devices' | Add-Content $out
if (Test-Path 'C:\AI\miners\srbminer\SRBMiner-MULTI.exe') { & 'C:\AI\miners\srbminer\SRBMiner-MULTI.exe' --list-devices *>> $out }
'--- lolMiner --list-devices' | Add-Content $out
if (Test-Path 'C:\AI\miners\lolminer\lolMiner.exe') { & 'C:\AI\miners\lolminer\lolMiner.exe' --list-devices *>> $out }
Get-Content $out -Tail 40 | ForEach-Object { '  ' + ($_ -replace "`0", '') }
'AFTER-CARD DONE'
