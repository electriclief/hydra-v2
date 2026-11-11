$ErrorActionPreference = 'SilentlyContinue'
$v1 = 'C:\Users\Leafdriving\Desktop\receive\deepseek'
$v2 = 'C:\Users\Leafdriving\Desktop\receive\hydraV2'
function Section($t) { '' ; '=== ' + $t }

Section 'v1 folders that look like file transfer'
Get-ChildItem $v1 -Recurse -Depth 4 -Directory | Where-Object { $_.Name -match '(?i)file|transfer|share|upload|download|ftp|send|receive|drop|box' } |
  Select-Object -First 30 | ForEach-Object { '  ' + $_.FullName.Replace($v1, '<v1>') }

Section 'v1 files that look like file transfer code'
Get-ChildItem $v1 -Recurse -Depth 4 -File -Include *.js,*.mjs,*.cjs,*.ts,*.html,*.ps1,*.py |
  Where-Object { $_.Name -match '(?i)file|transfer|share|upload|download|ftp' } |
  Select-Object -First 30 | ForEach-Object { '  {0,8} B  {1}' -f $_.Length, $_.FullName.Replace($v1, '<v1>') }

Section 'v2 modules and their shape'
Get-ChildItem (Join-Path $v2 'module') -Directory | ForEach-Object {
  $n = $_.Name
  $files = @(Get-ChildItem $_.FullName -Recurse -File | Where-Object { $_.Extension -in '.js','.mjs','.cjs','.html','.json' })
  '  {0,-20} {1,3} code files' -f $n, $files.Count
}

Section 'v2: any file transfer already there'
Get-ChildItem $v2 -Recurse -Depth 4 -File -Include *.js,*.mjs,*.cjs,*.html,*.json |
  Where-Object { $_.FullName -match '(?i)transfer|upload|download|files' } |
  Select-Object -First 20 | ForEach-Object { '  ' + $_.FullName.Replace($v2, '<v2>') }

Section 'v1 Hydra app structure (two levels)'
Get-ChildItem (Join-Path $v1 'app\Hydra') -Directory | ForEach-Object { '  ' + $_.Name ; Get-ChildItem $_.FullName -Directory | Select-Object -First 6 | ForEach-Object { '      ' + $_.Name } }
Section 'v1 hydra-stack structure'
Get-ChildItem (Join-Path $v1 'app\hydra-stack') -Directory | ForEach-Object { '  ' + $_.Name }
'FIND DONE'
