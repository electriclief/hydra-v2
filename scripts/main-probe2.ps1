$ErrorActionPreference = 'Continue'
function Section($t) { '' ; '=== ' + $t }
Section 'the old complaint: does it still switch itself off'
'  up now (min): ' + [math]::Round(((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalMinutes, 1)
Get-CimInstance Win32_OperatingSystem | ForEach-Object { '  last boot  : {0}' -f $_.LastBootUpTime }
Get-WinEvent -FilterHashtable @{LogName='System'; Id=41,6008,1074,109,110} -MaxEvents 8 -ErrorAction SilentlyContinue |
  ForEach-Object { '  {0:MM-dd HH:mm} id {1}  {2}' -f $_.TimeCreated, $_.Id, (($_.Message -split "`n")[0] -replace '\s+',' ').Trim() }
Section 'thermal / power hints'
Get-CimInstance Win32_Processor | ForEach-Object { '  cpu load {0}%  clock {1} MHz  max {2} MHz' -f $_.LoadPercentage, $_.CurrentClockSpeed, $_.MaxClockSpeed }
Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | ForEach-Object { '  thermal zone: {0:N1} C' -f (($_.CurrentTemperature / 10) - 273.15) }
Section 'windows on this hardware'
& cscript //nologo C:\Windows\System32\slmgr.vbs /xpr 2>&1 | ForEach-Object { '  ' + $_.Trim() }
$tl = Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' -ErrorAction SilentlyContinue
'  TPM present : ' + ((Get-Tpm -ErrorAction SilentlyContinue).TpmPresent)
'  SecureBoot  : ' + (try { Confirm-SecureBootUEFI -ErrorAction Stop } catch { 'legacy BIOS / not supported' })
Section 'gpu state'
'  AMD: ' + ((Get-CimInstance Win32_VideoController | Where-Object Name -match 'Radeon' | Select-Object -First 1).Name)
$smi = 'C:\Windows\System32\amdfendr.exe'
'  OpenCL via SRBMiner? ' + $(if (Test-Path 'C:\AI\miners') { 'miners dir present' } else { 'no C:\AI\miners here' })
Get-ChildItem 'C:\AI' -Directory -ErrorAction SilentlyContinue | ForEach-Object { '  ' + $_.Name }
Section 'hydra install'
Get-ChildItem 'C:\AI' -Directory -Recurse -Depth 2 -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '(?i)hydra' } | Select-Object -First 5 | ForEach-Object { '  ' + $_.FullName }
Get-ChildItem 'C:\Users\Leafdriving\Desktop' -Filter '*.lnk' -ErrorAction SilentlyContinue | ForEach-Object { '  desktop: ' + $_.Name }
Section 'virtualization'
'  Hyper-V feature: ' + (try { (Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -ErrorAction Stop).State } catch { 'unknown' })
MAIN PROBE 2 DONE
