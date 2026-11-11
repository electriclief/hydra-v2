# Two questions: which is the 4th Vulkan device, and can the R9 mine now that Windows Update gave it an OpenCL driver?
# Also: find out what the AMD installer actually is, since 7zr extracted zero files from it.
$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }

Section 'all Vulkan devices llama can see'
& 'C:\AI\llama\llama-bench.exe' --list-devices 2>&1 | Where-Object { $_ -match 'Found|Vulkan\d|error' } | ForEach-Object { '  ' + ($_ -replace "`0", '') }

Section 'SRBMiner device list (does it see the AMD card?)'
(& 'C:\AI\miners\srb380\SRBMiner-MULTI.exe' --list-devices 2>&1 | Where-Object { $_ -match '(?i)opencl|platform|GPU|CPU' } | Select-Object -First 14) |
  ForEach-Object { '  ' + ($_ -replace "`0", '') }

Section 'what is the AMD installer'
$exe = 'C:\AI\tools\amd2152-setup.exe'
foreach ($t in '7z', 'cab', 'nsis', 'installshield') {
  $r = & 'C:\AI\tools\7zr.exe' l "-t$t" $exe 2>&1 | Select-Object -First 4
  '  -t{0}: {1}' -f $t, (($r -join ' | ') -replace '\s+', ' ').Substring(0, [Math]::Min(160, (($r -join ' | ') -replace '\s+', ' ').Length))
}
'  --- first bytes'
$b = [System.IO.File]::ReadAllBytes($exe)[0..63]
'  ' + (($b | ForEach-Object { $_.ToString('X2') }) -join ' ')
'  ascii: ' + (($b | ForEach-Object { if ($_ -ge 32 -and $_ -lt 127) { [char]$_ } else { '.' } }) -join '')
'AMDOK2 DONE'
