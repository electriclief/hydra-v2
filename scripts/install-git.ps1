# Install Git for Windows silently and prove it runs afterwards.
# The installer is verified by SHA256 before it is executed: a 67 MB binary arriving over scp is a claim, the hash is the check.
$ErrorActionPreference = 'Continue'
$exe = 'C:\Users\User\git-setup.exe'
$want = 'c330c72e10b408cc39994bfefdb63542b0d93d21699325c3e0bd874af8a5a559'
'== ' + $env:COMPUTERNAME
if (-not (Test-Path $exe)) { '  installer missing at ' + $exe; 'GIT INSTALL FAILED'; exit 1 }
$got = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLower()
'  installer {0:N0} B  sha256 {1}' -f (Get-Item $exe).Length, $got
if ($got -ne $want) { '  HASH MISMATCH - refusing to run an installer I cannot account for'; 'GIT INSTALL FAILED'; exit 1 }
'  hash ok'

if (Get-Command git -ErrorAction SilentlyContinue) {
  '  git already present: ' + (Get-Command git).Source
} else {
  '  installing silently (Inno Setup, no reboot, git on PATH)...'
  $p = Start-Process -FilePath $exe -ArgumentList @(
    '/VERYSILENT','/NORESTART','/NOCANCEL','/SP-','/CLOSEAPPLICATIONS','/RESTARTAPPLICATIONS',
    '/o:PathOption=Cmd','/COMPONENTS='
  ) -Wait -PassThru
  '  installer exit code: ' + $p.ExitCode
}

# a NEW process is needed because the installer edits the machine PATH, and this process inherited the old one
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
$candidates = @('C:\Program Files\Git\cmd\git.exe','C:\Program Files\Git\bin\git.exe','C:\Program Files\Git\mingw64\bin\git.exe')
$found = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
'  git.exe on disk: ' + $(if ($found) { $found } else { 'NOT FOUND' })
if ($found) { '  version: ' + (& $found --version) }
$onPath = Get-Command git -ErrorAction SilentlyContinue
'  git on PATH (new process view): ' + ($(if ($onPath) { $onPath.Source } else { 'not yet - PATH needs a logon' }))
'  machine PATH contains Git: ' + (([Environment]::GetEnvironmentVariable('Path','Machine')) -match 'Git')
'GIT INSTALL DONE'
