# Finish the XPSW onboarding: identity, miner home, launcher, firewall. Then it is ready to raise.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
$root = 'C:\AI\hydra-local'

Section '1. identity'
$nj = Join-Path $root 'module\Menu\data\node.json'
New-Item -ItemType Directory -Force -Path (Split-Path $nj) | Out-Null
Copy-Item 'C:\Users\User\xpsw-node.json' $nj -Force
'  wrote ' + $nj + '  ' + (Get-Item $nj).Length + ' B'
try { $j = Get-Content $nj -Raw | ConvertFrom-Json; '  ref=' + $j.ref + '  name=' + $j.name + '  standby.after=' + $j.standby.after } catch { '  node.json does NOT parse: ' + $_.Exception.Message }

Section '2. miner home'
New-Item -ItemType Directory -Force -Path 'C:\AI\miners\lolminer','C:\AI\logs' | Out-Null
if (Test-Path 'C:\Users\User\lolMiner.exe') { Move-Item 'C:\Users\User\lolMiner.exe' 'C:\AI\miners\lolminer\lolMiner.exe' -Force }
'  lolMiner: ' + (Test-Path 'C:\AI\miners\lolminer\lolMiner.exe')
foreach ($f in 'xpsw-mine.cmd','relaunch-xpsw.cmd') {
  Copy-Item ("C:\Users\User\" + $f) (Join-Path $root ('scripts\' + $f)) -Force
  '  ' + $f + ' -> ' + (Test-Path (Join-Path $root ('scripts\' + $f)))
}

Section '3. firewall: the door range, inbound'
$r = Get-NetFirewallRule -DisplayName 'Hydra V2 doors 8125-8144' -ErrorAction SilentlyContinue
if (-not $r) {
  New-NetFirewallRule -DisplayName 'Hydra V2 doors 8125-8144' -Direction Inbound -Protocol TCP -LocalPort 8125-8144 -Action Allow -Profile Any | Out-Null
  '  created'
} else { '  already present' }
$r2 = Get-NetFirewallRule -DisplayName 'Hydra V2 doors 8125-8144' -ErrorAction SilentlyContinue
'  enabled=' + $r2.Enabled + '  direction=' + $r2.Direction + '  action=' + $r2.Action + '  profiles=' + $r2.Profile
$block = @(Get-NetFirewallRule -Direction Inbound -Action Block -Enabled True -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'node.exe*' })
'  block rules on node.exe: ' + $block.Count
$block | ForEach-Object { '    removing block: ' + $_.DisplayName; Remove-NetFirewallRule -Name $_.Name -ErrorAction SilentlyContinue }

Section '4. what is in place'
'  tools\node\node.exe       : ' + (Test-Path 'C:\AI\hydra-local\tools\node\node.exe')
'  tools\electron\electron.exe: ' + (Test-Path 'C:\AI\hydra-local\tools\electron\electron.exe')
'  module folders            : ' + ((Get-ChildItem 'C:\AI\hydra-local\module' -Directory | Select-Object -ExpandProperty Name) -join ', ')
'  app main.cjs              : ' + (Test-Path 'C:\AI\hydra-local\module\Basic_App\electron\main.cjs')
'XPSW INSTALL DONE'
