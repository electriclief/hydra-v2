# =====================================================================================
#  DEFENDER-ALLOW-XMRIG - a miner on disk will be quarantined, and a quarantined miner is indistinguishable from a broken
#  one: the file disappears and the launcher fails with "contains a virus". The fleet already took this decision for
#  SRBMiner; this is the same decision for xmrig, and it is scoped to the folder rather than to the whole disk.
#
#  What it changes: one Defender exclusion path. Nothing is disabled, real-time protection stays on.
# =====================================================================================
$ErrorActionPreference = 'Continue'
$dir = 'C:\AI\tools\xmrig'
'whoami: ' + (whoami)
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
'elevated: ' + $admin
if (-not $admin) { throw 'this needs an elevated session: Add-MpPreference is refused otherwise' }

'=== exclusions before'
Get-MpPreference | ForEach-Object { $_.ExclusionPath } | Where-Object { $_ } | ForEach-Object { '  ' + $_ }

try {
  Add-MpPreference -ExclusionPath $dir -ErrorAction Stop
  'added exclusion: ' + $dir
} catch { 'add failed: ' + $_.Exception.Message }

'=== exclusions after'
Get-MpPreference | ForEach-Object { $_.ExclusionPath } | Where-Object { $_ } | ForEach-Object { '  ' + $_ }

'=== is the exe still on disk?'
'  exists: ' + (Test-Path (Join-Path $dir 'xmrig.exe'))
Get-ChildItem $dir -ErrorAction SilentlyContinue | ForEach-Object { '  {0,-18} {1,10:N0}' -f $_.Name, $_.Length }

'=== quarantine history (what Defender took, and when)'
$q = Get-MpThreatDetection -ErrorAction SilentlyContinue | Sort-Object InitialDetectionTime -Descending | Select-Object -First 4
if ($q) { $q | ForEach-Object { '  {0:yyyy-MM-dd HH:mm} {1} {2} -> {3}' -f $_.InitialDetectionTime, $_.ThreatID, $_.ActionSuccess, (($_.Resources -join ' ')) } } else { '  nothing recorded' }
