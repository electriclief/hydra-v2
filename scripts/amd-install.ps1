# Install AMD's 21.5.2 legacy package the way NVIDIA had to be installed on this image: unpack, then pnputil.
# setup.exe is the thing that dies on a stripped Windows, so it is never run.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$cands = @(
  'C:\AI\tools\amd2152-setup.exe',
  'C:\Users\User\Downloads\radeon-software-adrenalin-2020-21.5.2-win10-64bit-legacyasics-june21-legacy.exe'
)
$exe = ($cands | Where-Object { Test-Path $_ } | Select-Object -First 1)
$dest = 'C:\AI\tools\amd2152'
$7z = 'C:\AI\tools\7zr.exe'

Section 'package'
if (-not $exe) { '  MISSING: none of ' + ($cands -join ' , '); 'AMDINSTALL DONE'; exit }
'  using: ' + $exe
'  {0:N0} bytes' -f (Get-Item $exe).Length

Section 'unpack'
if (-not (Test-Path $dest)) { New-Item -ItemType Directory -Force -Path $dest | Out-Null }
& $7z x $exe "-o$dest" -y 2>&1 | Select-Object -Last 3 | ForEach-Object { '  ' + $_ }

Section 'display INFs found'
$infs = @(Get-ChildItem $dest -Recurse -Filter '*.inf' -ErrorAction SilentlyContinue | Where-Object { $_.DirectoryName -match '(?i)display' })
if (-not $infs.Count) { $infs = @(Get-ChildItem $dest -Recurse -Filter '*.inf' -ErrorAction SilentlyContinue) }
foreach ($i in $infs) { '  {0,-14} {1}' -f $i.Name, $i.DirectoryName }
'  total inf: {0}' -f $infs.Count

Section 'does the package know DEV_6810 (R9 270X / Curacao XT)'
$hit = @()
foreach ($i in $infs) {
  $m = Select-String -Path $i.FullName -Pattern 'DEV_6810' -SimpleMatch -ErrorAction SilentlyContinue
  if ($m) { $hit += $i.Name; '  {0}: {1} match(es), first: {2}' -f $i.Name, $m.Count, ($m[0].Line.Trim().Substring(0, [Math]::Min(90, $m[0].Line.Trim().Length))) }
}
if (-not $hit.Count) { '  DEV_6810 not found in any INF - wrong package for this card' }

Section 'add the display INF (no /install first, so a failure is visible)'
$target = $infs | Where-Object { $_.Name -match '(?i)^(c|u|w).*\.inf$' } | Select-Object -First 1
if (-not $target) { $target = $infs[0] }
if ($target) {
  '  chosen: ' + $target.FullName
  & pnputil /add-driver $target.FullName 2>&1 | ForEach-Object { '  ' + $_.Trim() }
}

Section 'devices now'
Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like 'PCI\VEN_1002*' } |
  ForEach-Object { '  {0} [{1}] :: {2}' -f $_.FriendlyName, $_.Class, $_.Status }
'AMDINSTALL DONE'
