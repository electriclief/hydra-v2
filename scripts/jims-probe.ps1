# What is actually running on this box, and from where - the question the tree cannot answer for itself
# when there is no State door.
$ErrorActionPreference = 'SilentlyContinue'

'== node / electron / hydra processes'
Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'node|electron|standby-guard|pwsh|powershell' -and $_.CommandLine -match 'hydra|module|src\\\\main' } |
  Select-Object ProcessId, Name, CommandLine | Format-List | Out-String -Width 400 | Write-Output

'== any hydra repo on any fixed disk'
foreach ($d in (Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -ne $null })) {
  $p = Join-Path $d.Root 'AI\hydra-local'
  $q = Join-Path $d.Root 'hydra-local'
  foreach ($c in @($p, $q)) {
    if (Test-Path $c) { 'FOUND ' + $c }
  }
}
'== module dirs if a repo exists'
$repo = 'C:\AI\hydra-local'
if (Test-Path $repo) {
  'repo: ' + $repo
  Get-ChildItem (Join-Path $repo 'module') -Directory | Select-Object -ExpandProperty Name | Write-Output
  'scripts:'
  Get-ChildItem (Join-Path $repo 'scripts') -Filter '*.ps1' | Select-Object -ExpandProperty Name | Write-Output
} else { 'no repo at ' + $repo }

'== miner api on this box'
foreach ($port in 60000..60210) {
  $c = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
  if ($c) {
    '{0}: listening pid {1}' -f $port, $c.OwningProcess
    try {
      $r = Invoke-WebRequest ('http://127.0.0.1:' + $port + '/') -UseBasicParsing -TimeoutSec 4
      $j = $r.Content | ConvertFrom-Json
      $a = @($j.algorithms)[0]
      if ($a) { '   algo {0} rate {1} shares {2}' -f $a.name, $a.hashrate.'1min', ($a.shares | ConvertTo-Json -Compress) }
    } catch { '   (no json on that port)' }
  }
}

'== scheduled tasks that start any of this'
Get-ScheduledTask | Where-Object { $_.TaskName -match 'jim|hydra|llm|miner|guard' } |
  Select-Object TaskName, State | Format-Table -AutoSize | Out-String | Write-Output
