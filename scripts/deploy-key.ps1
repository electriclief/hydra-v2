# A read-only GitHub identity for this node: an ed25519 keypair that exists ONLY here, whose public half the operator
# pastes into the repo's Deploy keys. Nothing secret travels: the private key never leaves the disk it was made on, and
# no token is ever typed into a script or a chat.
#
# Why this is needed at all: the repo is private (GitHub answers 404 without auth). 123 can pull because it holds a
# stored credential from its first clone; a fresh node holds nothing, so `git fetch` stops at "could not read Username".
$ErrorActionPreference = 'Continue'
$keyDir = Join-Path $env:USERPROFILE '.ssh'
$key = Join-Path $keyDir 'hydra_deploy'
$ref = $null
$nj = 'C:\AI\hydra-local\module\Menu\data\node.json'
if (Test-Path $nj) { try { $ref = (Get-Content $nj -Raw | ConvertFrom-Json).ref } catch { } }
if (-not $ref) { $ref = $env:COMPUTERNAME.ToLower() }

$kd = @('C:\Windows\System32\OpenSSH\ssh-keygen.exe') | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $kd) { $kd = (Get-Command ssh-keygen -ErrorAction SilentlyContinue).Source }
'== ' + $env:COMPUTERNAME
if (-not $kd) { '  NO ssh-keygen on this box (OpenSSH client not installed) - deploy key route blocked'; 'DEPLOY KEY FAILED'; exit 1 }
'  ssh-keygen: ' + $kd

New-Item -ItemType Directory -Force -Path $keyDir | Out-Null
if (Test-Path $key) {
  '  key already exists: ' + $key
} else {
  & $kd -t ed25519 -N '""' -C ("hydra-" + $ref + "@" + $env:COMPUTERNAME) -f $key -q 2>&1 | ForEach-Object { '  | ' + $_ }
  '  key created: ' + $key
}
if (-not (Test-Path ($key + '.pub'))) { '  no public half - creation failed'; 'DEPLOY KEY FAILED'; exit 1 }

# github.com host key, so the first fetch does not stop on a fingerprint question
$sshDir = Join-Path $env:USERPROFILE '.ssh'
$kh = Join-Path $sshDir 'known_hosts'
$sc = @('C:\Windows\System32\OpenSSH\ssh-keyscan.exe') | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($sc) {
  $scanned = & $sc -t ed25519 github.com 2>$null
  if ($scanned) {
    $existing = if (Test-Path $kh) { Get-Content $kh -Raw } else { '' }
    if ($existing -notmatch 'github\.com') { Add-Content -Path $kh -Value $scanned; '  github.com host key added to known_hosts' } else { '  github.com already in known_hosts' }
  } else { '  ssh-keyscan returned nothing' }
} else { '  no ssh-keyscan - the first fetch will ask about the host key' }

# point origin at SSH so the deploy key is what git uses
Push-Location 'C:\AI\hydra-local'
& git remote set-url origin git@github.com:electriclief/hydra-v2.git 2>&1 | ForEach-Object { '  | ' + $_ }
'  origin now: ' + (& git remote get-url origin)
Pop-Location

'== PUBLIC KEY TO PASTE INTO GITHUB (deploy key, read-only, this node only)'
Get-Content ($key + '.pub')
'DEPLOY KEY DONE'
