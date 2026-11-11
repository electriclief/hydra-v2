# What the three toolchains say about this box before any add-in card is fitted, plus disk headroom.
# The installers write UTF-16 when redirected, so decode both - reading the wrong one gives NUL-riddled nonsense.
$ErrorActionPreference = 'Continue'
$f = 'C:\AI\logs\install-verify.txt'
if (-not (Test-Path $f)) { 'no verify log'; return }
$bytes = [System.IO.File]::ReadAllBytes($f)
$u8 = [System.Text.Encoding]::UTF8.GetString($bytes)
$u16 = [System.Text.Encoding]::Unicode.GetString($bytes)
$text = if ($u16.Length -gt $u8.Length -and (($u16 -split "`n").Count -gt 3)) { $u16 } else { $u8 }
$clean = ($text -split "`r?`n") | ForEach-Object { ($_ -replace '\x1b\[[0-9;]*m', '') } | Where-Object { $_.Trim() -ne '' }
$clean | Select-Object -First 45 | ForEach-Object { '  ' + $_ }

'=== binaries'
Get-ChildItem 'C:\AI\llama' -Filter 'llama-*.exe' | Select-Object -First 6 Name, @{ n = 'MB'; e = { [math]::Round($_.Length / 1MB, 1) } } | Format-Table -AutoSize | Out-String
Get-ChildItem 'C:\AI\miners' -Recurse -Filter '*.exe' | Select-Object Name, @{ n = 'MB'; e = { [math]::Round($_.Length / 1MB, 1) } }, @{ n = 'v'; e = { $_.VersionInfo.FileVersion } } | Format-Table -AutoSize | Out-String

'=== disk'
Get-PSDrive C | ForEach-Object { 'C: free {0:N1} GB of {1:N1} GB' -f ($_.Free / 1GB), (($_.Used + $_.Free) / 1GB) }
'=== vulkan runtime present?'
'vulkan-1.dll in System32 : ' + (Test-Path 'C:\Windows\System32\vulkan-1.dll')
'icd json (any)           : ' + (@(Get-ChildItem 'C:\Windows\System32\*vulkan*.json' -ErrorAction SilentlyContinue).Count)
