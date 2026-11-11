$ErrorActionPreference = 'Continue'
'== {0} ==' -f $env:COMPUTERNAME
$w = Get-Command winget -ErrorAction SilentlyContinue
'  winget        : ' + $(if ($w) { (winget --version) } else { 'NO' })
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
'  admin         : ' + $admin
try {
  $r = Invoke-WebRequest -Uri 'https://github.com' -UseBasicParsing -TimeoutSec 12 -Method Head
  '  github.com    : HTTP ' + $r.StatusCode
} catch { '  github.com    : UNREACHABLE (' + $_.Exception.Message.Substring(0,[Math]::Min(60,$_.Exception.Message.Length)) + ')' }
'  C: free GB    : ' + [math]::Round((Get-Volume C).SizeRemaining/1GB,1)
'  git now       : ' + $(if (Get-Command git -ErrorAction SilentlyContinue) { (Get-Command git).Source } else { 'none' })
'  user PATH has git: ' + (([Environment]::GetEnvironmentVariable('Path','User')) -match 'Git')
