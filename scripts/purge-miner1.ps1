# Shrink miner1 for imaging. Everything here is redundant on a box that only mines:
#   llama.cpp binaries + the GGUF models (moved to the controller first)
#   three extracted NVIDIA driver packages and their installers - the drivers are already in the DriverStore
#   the AMD legacy installer, temp folders, the Windows Update download cache, then component cleanup
# Nothing under C:\AI\miners, C:\AI\logs, C:\AI\tools\*.ps1 or the mining task is touched.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
function DirSize($p) {
  if (-not (Test-Path $p)) { return 0 }
  $s = (Get-ChildItem $p -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
  if (-not $s) { return 0 }
  return [math]::Round($s / 1MB, 1)
}
$before = (Get-Volume -DriveLetter C)
Section 'before'
'  C: used {0:N1} GB   free {1:N1} GB' -f (($before.Size - $before.SizeRemaining) / 1GB), ($before.SizeRemaining / 1GB)

$targets = @(
  @('llama.cpp binaries',   'C:\AI\llama'),
  @('NVIDIA 580 package',   'C:\AI\tools\nv580'),
  @('NVIDIA 582 package',   'C:\AI\tools\nv582'),
  @('NVIDIA 591 package',   'C:\AI\tools\nv591'),
  @('NVIDIA installers',    'C:\AI\tools\dl'),
  @('AMD unpacked package', 'C:\AI\tools\amd2152'),
  @('AMD legacy installer', 'C:\AI\tools\amd2152-setup.exe'),
  @('Windows Update cache', 'C:\Windows\SoftwareDistribution\Download'),
  @('Windows Temp',         'C:\Windows\Temp'),
  @('user Temp',            'C:\Users\User\AppData\Local\Temp')
)
Section 'deleting'
$freed = 0
foreach ($t in $targets) {
  $label = $t[0]; $path = $t[1]
  if (-not (Test-Path $path)) { '  {0,-22} absent' -f $label; continue }
  $mb = if (Test-Path $path -PathType Leaf) { [math]::Round((Get-Item $path -Force).Length / 1MB, 1) } else { DirSize $path }
  if ($label -eq 'Windows Update cache') { Stop-Service wuauserv -Force -ErrorAction SilentlyContinue; Stop-Service bits -Force -ErrorAction SilentlyContinue }
  try {
    Remove-Item $path -Recurse -Force -ErrorAction SilentlyContinue
    $left = if (Test-Path $path) { DirSize $path } else { 0 }
    $freed += ($mb - $left)
    '  {0,-22} {1,8:N0} MB  -> removed, {2:N0} MB still locked' -f $label, $mb, $left
  } catch { '  {0,-22} FAILED: {1}' -f $label, $_.Exception.Message }
}
Start-Service wuauserv -ErrorAction SilentlyContinue
Start-Service bits -ErrorAction SilentlyContinue

Section 'component cleanup (WinSxS)'
& Dism.exe /Online /Cleanup-Image /StartComponentCleanup /ResetBase 2>&1 | Select-String -Pattern 'complete|error|The operation' | ForEach-Object { '  ' + $_.Line.Trim() }

Section 'recycle bin'
Clear-RecycleBin -DriveLetter C -Force -ErrorAction SilentlyContinue
'  emptied'

$after = (Get-Volume -DriveLetter C)
Section 'after'
'  C: used {0:N1} GB   free {1:N1} GB' -f (($after.Size - $after.SizeRemaining) / 1GB), ($after.SizeRemaining / 1GB)
'  reclaimed {0:N1} GB of disk' -f ((($before.Size - $before.SizeRemaining) - ($after.Size - $after.SizeRemaining)) / 1GB)
Section 'what survived (must still be here)'
foreach ($k in 'C:\AI\miners', 'C:\AI\tools\mine-overnight.ps1', 'C:\AI\logs') { '  {0,-32} {1}' -f $k, $(if (Test-Path $k) { 'present' } else { 'MISSING' }) }
'  mining task: ' + (Get-ScheduledTask -TaskName 'HydraMine1' -ErrorAction SilentlyContinue).State
try { $a = Invoke-RestMethod 'http://127.0.0.1:60220/' -TimeoutSec 8; $alg = @($a.algorithms)[0]; '  hashrate now: {0:N0} H/s  A{1} R{2}' -f $alg.hashrate.'15min', $alg.shares.accepted, $alg.shares.rejected } catch { '  api: ' + $_.Exception.Message }
'PURGE DONE'
