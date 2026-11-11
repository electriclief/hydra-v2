$ErrorActionPreference = 'Continue'
'== shelf.log'
if (Test-Path 'C:\AI\hydra-local\logs\shelf.log') { Get-Content 'C:\AI\hydra-local\logs\shelf.log' -Tail 25 | ForEach-Object { '  ' + ($_ -replace '\s+',' ').Trim() } } else { '  no shelf.log' }
'== node processes'
$n = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'")
'  count: ' + $n.Count
$n | Select-Object -First 4 | ForEach-Object { $cl = ($_.CommandLine -replace '\s+',' '); '  pid {0} {1}' -f $_.ProcessId, $cl.Substring(0,[Math]::Min(90,$cl.Length)) }
'== can it even parse the shelf script'
$s = 'C:\AI\hydra-local\shelf-headless.mjs'
if (Test-Path $s) { '  size ' + (Get-Item $s).Length + ' B' }
'== try running it in the foreground to see the error'
Push-Location 'C:\AI\hydra-local'
$env:HYDRA_NODE = 'C:\Program Files\nodejs\node.exe'
$env:HYDRA_HOST = '0.0.0.0'
$env:HYDRA_MODULE_ROOT = 'C:\AI\hydra-local\module'
$out = & 'C:\Program Files\nodejs\node.exe' $s 2>&1 | Select-Object -First 20
Pop-Location
$out | ForEach-Object { '  | ' + ($_ -replace '\s+',' ') }
'1660 WHY DONE'
