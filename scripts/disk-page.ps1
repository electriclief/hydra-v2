# =====================================================================================
#  disk-page.ps1 - one command per drive: read the disk on the node, pull the facts,
#                  render a page, print it on the Brother. One sheet per drive, one-sided.
#
#  Usage (on 123):
#    powershell -File disk-page.ps1 -Node jims                 # every NON-system disk on that box
#    powershell -File disk-page.ps1 -Node jims -All            # include the boot disk
#    powershell -File disk-page.ps1 -Node jims -DryRun         # render only, print nothing
#    powershell -File disk-page.ps1 -Node jims -NoScan         # reuse the last facts already pulled
#    powershell -File disk-page.ps1 -Node jims -Disposition    # drives whose data nobody wants:
#                                                              # health verdict only, no file walk
#
#  It never writes to the drive it is reporting on: disk-facts.ps1 only reads.
# =====================================================================================
param(
  [string]$Node = 'jims',
  [string]$User = 'user',     # the node NAME is not the login name
  [string]$Key = "$env:USERPROFILE\.ssh\id_ed25519_echidna",
  [string]$Roster = 'C:\AI\fleet\roster.json',
  [switch]$All,
  [switch]$DryRun,
  [switch]$NoScan,
  [switch]$Reprint,      # print a sheet again for a drive that already has one
  [int]$ScanSeconds = 40,
  [switch]$Disposition,  # data on these drives is not wanted: grade health only, skip the file walk
  [string]$Printer = 'Brother DCP-L2550DW'
)
$ErrorActionPreference = 'Stop'

$row = (Get-Content $Roster -Raw | ConvertFrom-Json).nodes | Where-Object { $_.name -eq $Node }
$ip = if ($row -and $row.ip) { $row.ip } else { $Node }
'node {0} -> {1}' -f $Node, $ip

$sshArgs = @('-i', $Key, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=15')
$local = Join-Path 'C:\AI\reports\disk-facts' $Node
New-Item -ItemType Directory -Force $local | Out-Null

if (-not $NoScan) {
  # the facts script lives on the node; ship it every time so the box always runs the current rules
  & scp @sshArgs 'C:\AI\hydra-local\scripts\disk-facts.ps1' "${User}@${ip}:C:/Users/User/disk-facts.ps1" 2>&1 | Out-Null
  'reading the drives on {0} (bounded file count, {1}s per disk)...' -f $Node, $ScanSeconds
  $scanFlag = if ($Disposition) { '-NoScan' } else { '' }
  $out = & ssh @sshArgs "${User}@$ip" "cmd /c del /q C:\AI\reports\disk-facts\*.json 2>nul & powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\User\disk-facts.ps1 -ScanSeconds $ScanSeconds $scanFlag" 2>&1
  $out | Where-Object { $_ -and $_ -notmatch 'WARNING' } | Write-Output
  Remove-Item (Join-Path $local 'disk-*.json') -ErrorAction SilentlyContinue   # never the ledger
  & scp @sshArgs "${User}@${ip}:C:/AI/reports/disk-facts/*.json" $local 2>&1 | Out-Null
}

$files = @(Get-ChildItem (Join-Path $local 'disk-*.json') | Sort-Object Name)   # not the ledger
if (-not $files.Count) { throw "no facts pulled from $Node - did disk-facts.ps1 run?" }

# a pile of ten disks gets cycled more than once: keep a ledger of what already has a sheet, so a
# second run prints only the drive that was just inserted instead of the whole stack again
$ledgerPath = Join-Path $local 'printed.json'
$printed = @{}
if ((Test-Path $ledgerPath) -and -not $Reprint) {
  try { (Get-Content $ledgerPath -Raw | ConvertFrom-Json).printed | ForEach-Object { $printed[[string]$_] = $true } } catch { }
}

$pick = @()
$pickedSerials = @()
foreach ($f in $files) {
  $d = Get-Content $f.FullName -Raw | ConvertFrom-Json
  if (-not $d.device.model) { continue }        # a report with no identity is not a drive
  if (-not $All -and ($d.device.is_system -or $d.device.is_boot)) {
    '  skipped (system disk): {0} {1}' -f $d.device.model, $d.device.serial
    continue
  }
  $ser = [string]$d.device.serial
  if ($printed.ContainsKey($ser)) {
    '  already printed: {0,-26} {1,-7} {2}  {3}' -f $d.device.model, $d.verdict, $d.rating, $d.pile
    continue
  }
  $pick += $f.FullName
  $pickedSerials += $ser
  '  NEW  {0,-26} {1,-7} {2}  {3}' -f $d.device.model, $d.verdict, $d.rating, $d.pile
}
if (-not $pick.Count) { 'no new drive since the last run - use -Reprint to print again'; return }

$jsonArg = ($pick -join ',')
$printerArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'C:\AI\hydra-local\scripts\print-disk-report.ps1', '-Json', $jsonArg, '-Printer', $Printer)
if ($DryRun) { $printerArgs += '-DryRun' }
& powershell @printerArgs

if (-not $DryRun) {
  $ledgerList = @()
  if (Test-Path $ledgerPath) { try { $ledgerList = @((Get-Content $ledgerPath -Raw | ConvertFrom-Json).printed) } catch { } }
  $ledgerList = @($ledgerList + $pickedSerials | Select-Object -Unique)
  [pscustomobject]@{ printed = $ledgerList } | ConvertTo-Json | Set-Content $ledgerPath -Encoding UTF8
  'ledger: {0} drive(s) have a sheet' -f $ledgerList.Count
}
