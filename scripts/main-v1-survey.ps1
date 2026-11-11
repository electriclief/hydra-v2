$ErrorActionPreference = 'SilentlyContinue'
$v1 = 'C:\Users\Leafdriving\Desktop\receive\deepseek\app\Hydra'
function Section($t) { '' ; '=== ' + $t }

Section 'v1 client source tree (no node_modules, depth 3)'
Get-ChildItem (Join-Path $v1 'client') -Recurse -Depth 3 -File |
  Where-Object { $_.FullName -notmatch 'node_modules' -and $_.Extension -in '.js','.mjs','.cjs','.html','.json','.ts' } |
  Sort-Object Length -Descending | Select-Object -First 25 |
  ForEach-Object { '  {0,8} B  {1}' -f $_.Length, $_.FullName.Replace($v1, '<v1>') }

Section 'v1 server source tree (no node_modules)'
Get-ChildItem (Join-Path $v1 'server') -Recurse -Depth 2 -File |
  Where-Object { $_.FullName -notmatch 'node_modules' -and $_.Extension -in '.js','.mjs','.cjs','.html','.json' } |
  Sort-Object Length -Descending | Select-Object -First 20 |
  ForEach-Object { '  {0,8} B  {1}' -f $_.Length, $_.FullName.Replace($v1, '<v1>') }

Section 'where webtorrent / transfer is actually wired (source only)'
Get-ChildItem $v1 -Recurse -Depth 4 -File -Include *.js,*.mjs,*.cjs,*.html |
  Where-Object { $_.FullName -notmatch 'node_modules|dist\\asar' } |
  ForEach-Object {
    $hits = Select-String -Path $_.FullName -Pattern 'webtorrent|WebTorrent|createTorrent|torrent' -List
    if ($hits) { '  {0,8} B  {1}' -f $_.Length, $_.FullName.Replace($v1, '<v1>') }
  }

Section 'package.json of the client (the transfer dependencies)'
$pj = Join-Path $v1 'client\package.json'
if (Test-Path $pj) { Get-Content $pj -Raw | ForEach-Object { $_.Substring(0, [Math]::Min(1800, $_.Length)) } }
'V1 SURVEY DONE'
