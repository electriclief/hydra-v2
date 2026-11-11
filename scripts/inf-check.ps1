# Definitive check: does this package list the device ids we care about, and in which INF / on which line?
# Prints the matching line so the answer is visible rather than inferred from a regex.
$ErrorActionPreference = 'Continue'
$ids = @('1F82', '1C82', '17C8', '2182')
$infs = @(Get-ChildItem 'C:\AI\tools\nv582' -Recurse -Filter '*.inf' -ErrorAction SilentlyContinue)
'inf files scanned : {0}' -f $infs.Count
foreach ($id in $ids) {
  $hits = @()
  foreach ($f in $infs) {
    try {
      $m = Select-String -Path $f.FullName -Pattern $id -SimpleMatch -ErrorAction Stop | Select-Object -First 1
      if ($m) { $hits += [pscustomobject]@{ file = $f.Name; line = $m.Line.Trim() } }
    } catch { }
  }
  if ($hits.Count) {
    '{0}  FOUND in {1} file(s)' -f $id, $hits.Count
    $hits | Select-Object -First 2 | ForEach-Object { '     {0}: {1}' -f $_.file, ($_.line.Substring(0, [Math]::Min(110, $_.line.Length))) }
  } else { '{0}  not present' -f $id }
}
'--- nv_dispi.inf model section, first 6 device entries as written'
$disp = 'C:\AI\tools\nv582\Display.Driver\nv_dispi.inf'
if (Test-Path $disp) {
  Select-String -Path $disp -Pattern 'NVIDIA_DEV\.' -ErrorAction SilentlyContinue | Select-Object -First 6 |
    ForEach-Object { '  ' + $_.Line.Trim() }
} else { '  nv_dispi.inf not found' }
