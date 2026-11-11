# A 4 GB host running four GPUs (three CUDA contexts + one OpenCL) ran out of commit, not VRAM:
#   cuMemAlloc_v2 failed: CUDA_ERROR_OUT_OF_MEMORY x6   and   "the paging file is too small for this operation"
# commit limit was 5,388 MB with a system-managed pagefile that had SHRUNK. Give the box a fixed, generous pagefile so the
# driver stacks have backing to page against. C: has ~230 GB free.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }

Section 'stop the miners so nothing is holding GPU memory through the change'
Stop-ScheduledTask -TaskName 'HydraMine1' -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
Get-Process SRBMiner-MULTI -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'mine-overnight' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 4

Section 'pagefile before'
$cs = Get-CimInstance Win32_ComputerSystem
'  automatic managed: ' + $cs.AutomaticManagedPagefile
Get-CimInstance Win32_PageFileSetting -ErrorAction SilentlyContinue | ForEach-Object { '  {0}  initial {1} MB  max {2} MB' -f $_.Name, $_.InitialSize, $_.MaximumSize }
$os = Get-CimInstance Win32_OperatingSystem
'  commit limit {0:N0} MB   free physical {1:N0} MB' -f ($os.TotalVirtualMemorySize / 1024), ($os.FreePhysicalMemory / 1KB)

Section 'set a fixed 8 GB-16 GB pagefile on C:'
if ($cs.AutomaticManagedPagefile) {
  Set-CimInstance -InputObject $cs -Property @{ AutomaticManagedPagefile = $false } -ErrorAction SilentlyContinue
  '  automatic management turned off'
}
$pf = Get-CimInstance Win32_PageFileSetting -Filter "Name='C:\\pagefile.sys'" -ErrorAction SilentlyContinue
if ($pf) {
  Set-CimInstance -InputObject $pf -Property @{ InitialSize = 8192; MaximumSize = 16384 } -ErrorAction SilentlyContinue
  '  existing pagefile resized'
} else {
  New-CimInstance -ClassName Win32_PageFileSetting -Property @{ Name = 'C:\pagefile.sys'; InitialSize = 8192; MaximumSize = 16384 } -ErrorAction SilentlyContinue | Out-Null
  '  pagefile entry created'
}
Section 'pagefile after (takes effect at reboot)'
Get-CimInstance Win32_PageFileSetting -ErrorAction SilentlyContinue | ForEach-Object { '  {0}  initial {1} MB  max {2} MB' -f $_.Name, $_.InitialSize, $_.MaximumSize }
'  registry:'
Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management' -Name PagingFiles, ExistingPageFiles -ErrorAction SilentlyContinue | ForEach-Object { '  PagingFiles = {0}' -f ($_.PagingFiles -join ' | '); '  Existing  = {0}' -f ($_.ExistingPageFiles -join ' | ') }
'PAGEFILE DONE'
