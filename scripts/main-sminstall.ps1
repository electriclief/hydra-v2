$ErrorActionPreference = 'Continue'
'  admin check: ' + ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
'  installer present: ' + (Test-Path (Join-Path $env:USERPROFILE 'sm-setup.exe'))
$f = Get-ChildItem 'C:\' -Recurse -Filter 'smartctl.exe' -ErrorAction SilentlyContinue -Depth 5 | Select-Object -First 3
if ($f) { $f | ForEach-Object { '  found: ' + $_.FullName } } else { '  smartctl.exe not found anywhere under C:\ (depth 5)' }
'  --- retry silent install with exit code'
$setup = Join-Path $env:USERPROFILE 'sm-setup.exe'
if (Test-Path $setup) {
  $p = Start-Process -FilePath $setup -ArgumentList '/S' -PassThru -Wait
  '  exit: ' + $p.ExitCode
  Start-Sleep -Seconds 4
  '  now exists: ' + (Test-Path 'C:\Program Files\smartmontools\bin\smartctl.exe')
}
if (Test-Path 'C:\Program Files\smartmontools\bin\smartctl.exe') {
  '  version: ' + (& 'C:\Program Files\smartmontools\bin\smartctl.exe' --version | Select-Object -First 1)
}
'RETRY DONE'
