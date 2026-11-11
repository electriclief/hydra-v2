# The repo is public now, so no credential is needed anywhere: point origin back at HTTPS (the deploy-key pass had set
# SSH, which would demand a key GitHub never heard of) and let make-checkout.ps1 do the fetch + HEAD alignment.
$ErrorActionPreference = 'Continue'
'== ' + $env:COMPUTERNAME
$git = 'C:\Program Files\Git\cmd\git.exe'
if (-not (Test-Path $git)) { $git = (Get-Command git -ErrorAction SilentlyContinue).Source }
Push-Location 'C:\AI\hydra-local'
& $git remote set-url origin https://github.com/electriclief/hydra-v2.git 2>&1 | ForEach-Object { '  | ' + $_ }
'  origin: ' + (& $git remote get-url origin)
Pop-Location
'PUBLIC ORIGIN SET'
