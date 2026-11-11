# miner1 bring-up: the whole toolchain this board will ever run, installed before the first card goes in.
#   llama.cpp (Vulkan)   - talks to the card through Vulkan, so an old Intel chipset and a modern NVIDIA card coexist
#   SRBMiner-MULTI       - the fleet's AMD/NVIDIA generalist
#   lolMiner             - the fallback that still ships Maxwell-through-Ada kernels
# Nothing is started. Every binary is asked what devices IT can see, so the answer is a measurement, not a hope.
$ErrorActionPreference = 'Continue'
function Say($t) { Write-Host $t }

$root = 'C:\AI'
$dl = Join-Path $root 'tools\dl'
$llama = Join-Path $root 'llama'
$srb = Join-Path $root 'miners\srbminer'
$lol = Join-Path $root 'miners\lolminer'
$logs = Join-Path $root 'logs'
foreach ($d in @($dl, $llama, $srb, $lol, $logs)) { New-Item -ItemType Directory -Force $d | Out-Null }

$me = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = (New-Object Security.Principal.WindowsPrincipal($me)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Say ('account {0}  administrator={1}' -f $me.Name, $isAdmin)
if ($isAdmin) {
  Add-MpPreference -ExclusionPath $root -ErrorAction SilentlyContinue
  Say ('defender exclusions: ' + (((Get-MpPreference).ExclusionPath) -join ', '))
} else {
  Say 'NOT ADMIN - no exclusion, no silent installer; re-run elevated'
}

Say ('free space on C: {0:N1} GB' -f ((Get-PSDrive C).Free / 1GB))
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
Say ('cpu {0}  cores {1}  threads {2}   ram {3:N1} GB' -f $cpu.Name, $cpu.NumberOfCores, $cpu.NumberOfLogicalProcessors,
  ((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB))

function Get-Zip($url, $dest) {
  Say ('  downloading {0}' -f (Split-Path $url -Leaf))
  & curl.exe -L --retry 3 --fail --silent --show-error -o $dest $url
  if ($LASTEXITCODE -ne 0) { Say ('  FAILED (' + $LASTEXITCODE + '): ' + $url); return $false }
  Say ('  {0:N1} MB' -f ((Get-Item $dest).Length / 1MB))
  return $true
}

function Expand-Flat($zip, $dest) {
  $tmp = Join-Path $env:TEMP ('x-' + [IO.Path]::GetFileNameWithoutExtension($zip))
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  Get-ChildItem $tmp -Recurse -File | ForEach-Object { Copy-Item $_.FullName (Join-Path $dest $_.Name) -Force }
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
}

Say '=== VC++ runtime (every miner and llama.cpp link against it)'
$vc = Join-Path $dl 'vc_redist.x64.exe'
if (Test-Path 'C:\Windows\System32\vcruntime140_1.dll') {
  Say '  already present (vcruntime140_1.dll)'
} elseif (Get-Zip 'https://aka.ms/vs/17/release/vc_redist.x64.exe' $vc) {
  $p = Start-Process -FilePath $vc -ArgumentList '/install', '/quiet', '/norestart' -Wait -PassThru
  Say ('  installer exit ' + $p.ExitCode)
  Remove-Item $vc -Force -ErrorAction SilentlyContinue
} else { Say '  could not fetch vc_redist - the miners will fail with 0xC0000135 until it is installed' }

Say '=== llama.cpp (Vulkan)'
$llamaExe = Join-Path $llama 'llama-server.exe'
if (Test-Path $llamaExe) { Say '  already installed' }
else {
  $z = Join-Path $dl 'llama-vulkan.zip'
  if (Get-Zip 'https://github.com/ggml-org/llama.cpp/releases/download/b12228/llama-b12228-bin-win-vulkan-x64.zip' $z) { Expand-Flat $z $llama }
}
if (Test-Path $llamaExe) { Say ('  llama-server.exe  {0:N1} MB' -f ((Get-Item $llamaExe).Length / 1MB)) } else { Say '  MISSING llama-server.exe' }

Say '=== SRBMiner-MULTI 3.8.6'
$srbExe = Join-Path $srb 'SRBMiner-MULTI.exe'
if (Test-Path $srbExe) { Say '  already installed' }
else {
  $z = Join-Path $dl 'srb.zip'
  if (Get-Zip 'https://github.com/doktor83/SRBMiner-Multi/releases/download/3.8.6/SRBMiner-Multi-3-8-6-win64.zip' $z) { Expand-Flat $z $srb }
}
if (Test-Path $srbExe) { Say ('  SRBMiner-MULTI.exe  v{0}' -f (Get-Item $srbExe).VersionInfo.FileVersion) } else { Say '  MISSING SRBMiner-MULTI.exe' }

Say '=== lolMiner 1.98a'
$lolExe = Join-Path $lol 'lolMiner.exe'
if (Test-Path $lolExe) { Say '  already installed' }
else {
  $z = Join-Path $dl 'lol.zip'
  if (Get-Zip 'https://github.com/Lolliedieb/lolMiner-releases/releases/download/1.98a/lolMiner_v1.98a_Win64.zip' $z) { Expand-Flat $z $lol }
}
if (Test-Path $lolExe) { Say ('  lolMiner.exe  v{0}' -f (Get-Item $lolExe).VersionInfo.FileVersion) } else { Say '  MISSING lolMiner.exe' }

Say '=== what each one can see right now (no add-in card is fitted yet)'
$out = Join-Path $logs 'install-verify.txt'
Remove-Item $out -Force -ErrorAction SilentlyContinue
'--- llama.cpp --list-devices' | Add-Content $out
if (Test-Path (Join-Path $llama 'llama-cli.exe')) { & (Join-Path $llama 'llama-cli.exe') --list-devices *>> $out }
elseif (Test-Path $llamaExe) { & $llamaExe --list-devices *>> $out }
'--- SRBMiner --list-devices' | Add-Content $out
if (Test-Path $srbExe) { & $srbExe --list-devices *>> $out }
'--- lolMiner --list-devices' | Add-Content $out
if (Test-Path $lolExe) { & $lolExe --list-devices *>> $out }
Get-Content $out | Select-Object -First 60 | ForEach-Object { '  ' + $_ }

Say '=== desktop launchers'
$ws = New-Object -ComObject WScript.Shell
$desk = [Environment]::GetFolderPath('Desktop')

function New-Cmd($path, $lines) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, ($lines -join "`r`n") + "`r`n", $enc)
}
$llamaCmd = Join-Path $root 'tools\llama-server.cmd'
New-Cmd $llamaCmd @(
  '@echo off',
  'REM llama-server with the Vulkan backend - the card does the work, the 2 cores feed it.',
  'REM -ngl 99 = all layers on the GPU.  Swap the model path for whatever is in C:\AI\models.',
  'cd /d "' + $llama + '"',
  '"' + $llamaExe + '" -m "C:\AI\models\model.gguf" --host 0.0.0.0 --port 8080 -ngl 99 -c 4096',
  'pause'
)
New-Cmd (Join-Path $root 'tools\srbminer-console.cmd') @(
  '@echo off',
  'REM SRBMiner with its own console so the shares scroll where a person can see them.',
  'cd /d "' + $srb + '"',
  '"' + $srbExe + '" --list-devices',
  'pause'
)
New-Cmd (Join-Path $root 'tools\lolminer-console.cmd') @(
  '@echo off',
  'REM lolMiner device list - proves the card enumerates before any long run.',
  'cd /d "' + $lol + '"',
  '"' + $lolExe + '" --list-devices',
  'pause'
)
$links = @(
  @{ name = 'llama.cpp (Vulkan).lnk'; target = $llamaCmd },
  @{ name = 'SRBMiner devices.lnk'; target = (Join-Path $root 'tools\srbminer-console.cmd') },
  @{ name = 'lolMiner devices.lnk'; target = (Join-Path $root 'tools\lolminer-console.cmd') }
)
foreach ($l in $links) {
  $p = Join-Path $desk $l.name
  $sc = $ws.CreateShortcut($p)
  $sc.TargetPath = $l.target
  $sc.WorkingDirectory = Split-Path $l.target -Parent
  $sc.Save()
  '  ' + $p
}

Say '=== summary'
'{0,-26} {1}' -f 'llama-server.exe', $(if (Test-Path $llamaExe) { 'installed' } else { 'MISSING' })
'{0,-26} {1}' -f 'SRBMiner-MULTI.exe', $(if (Test-Path $srbExe) { 'installed' } else { 'MISSING' })
'{0,-26} {1}' -f 'lolMiner.exe', $(if (Test-Path $lolExe) { 'installed' } else { 'MISSING' })
'{0,-26} {1}' -f 'vc runtime', $(if (Test-Path 'C:\Windows\System32\vcruntime140_1.dll') { 'present' } else { 'MISSING' })
'{0,-26} {1}' -f 'defender exclusion', $(if ($isAdmin) { 'C:\AI' } else { 'not added (not admin)' })
'SETUP DONE'
