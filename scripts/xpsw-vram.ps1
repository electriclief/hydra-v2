# The card degrades from 19.3 MH/s to 4 MH/s once a desktop is logged in, and the numbers say why:
#   SM 721 MHz of 1961, MEMORY 810 MHz of 4004, 22 W, throttle reason 0x1 (GpuIdle), 5056 of 6144 MiB used.
# An etchash DAG on this card is ~4.2 GB, so with Edge, Office Hub (M365Copilot), EdgeWebView2 and the Hydra window
# also resident there is no headroom: WDDM pages the DAG out, the memory clock collapses to idle, and every hash
# becomes a system-RAM fetch. The miner is not broken — the box is over-subscribed by desktop junk.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }

Section '1. before'
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=clocks.sm,clocks.mem,power.draw,memory.used --format=csv,noheader
try { $a = Invoke-RestMethod 'http://127.0.0.1:60151/' -TimeoutSec 8; '  miner: {0:N2} MH/s' -f (@($a.Algorithms)[0].Total_Performance) } catch { '  miner api down' }

Section '2. close what is eating the card (reversible: these are desktop apps, not services)'
$kill = 'msedge', 'M365Copilot', 'MicrosoftOfficeHub', 'msedgewebview2', 'OfficeClickToRun', 'OneDrive'
foreach ($n in $kill) {
  $p = @(Get-Process $n -ErrorAction SilentlyContinue)
  if ($p.Count) { $p | Stop-Process -Force -ErrorAction SilentlyContinue; '  stopped {0} x{1}' -f $n, $p.Count } else { '  {0}: not running' -f $n }
}

Section '3. stop them coming back at logon'
foreach ($k in 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run') {
  if (Test-Path $k) {
    $props = Get-ItemProperty $k
    $props.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { '  run: {0} = {1}' -f $_.Name, ([string]$_.Value).Substring(0,[Math]::Min(70,([string]$_.Value).Length)) }
    foreach ($name in 'MicrosoftEdgeAutoLaunch', 'msedge', 'M365Copilot', 'OneDrive') {
      if ($props.PSObject.Properties.Name -contains $name) { Remove-ItemProperty -Path $k -Name $name -Force; '  removed Run entry: ' + $name }
    }
  }
}
Get-ChildItem ([Environment]::GetFolderPath('Startup')) | ForEach-Object { '  startup: ' + $_.Name }

Section '4. after (give the driver 20 s to re-clock)'
Start-Sleep -Seconds 20
& 'C:\Windows\System32\nvidia-smi.exe' --query-gpu=clocks.sm,clocks.mem,power.draw,memory.used,utilization.gpu,pstate --format=csv,noheader
& 'C:\Windows\System32\nvidia-smi.exe' --query-compute-apps=pid,process_name --format=csv,noheader | Select-Object -First 6 | ForEach-Object { '  gpu: ' + $_ }
'XPSW VRAM DONE'
