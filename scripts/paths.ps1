foreach ($p in 'C:\AI\tools\nv582', 'C:\AI\tools\nv591', 'C:\AI\tools\dl\nvidia-582.66.exe', 'C:\AI\tools\dl\nvidia-591.86.exe', 'C:\AI\miners\srb380\SRBMiner-MULTI.exe', 'C:\AI\miners\srbminer\SRBMiner-MULTI.exe', 'C:\AI\tools\7zr.exe') {
  '{0,-6} {1}' -f (Test-Path $p), $p
}
'--- C:\AI\tools'
Get-ChildItem 'C:\AI\tools' -ErrorAction SilentlyContinue | Select-Object Name, @{n = 'MB'; e = { [math]::Round($_.Length / 1MB, 1) } } | Format-Table -AutoSize | Out-String -Width 100
'--- C:\AI\tools\dl'
Get-ChildItem 'C:\AI\tools\dl' -ErrorAction SilentlyContinue | Select-Object Name, @{n = 'MB'; e = { [math]::Round($_.Length / 1MB, 1) } } | Format-Table -AutoSize | Out-String -Width 100
'--- disk'
Get-PSDrive C | Select-Object @{n = 'UsedGB'; e = { [math]::Round($_.Used / 1GB, 1) } }, @{n = 'FreeGB'; e = { [math]::Round($_.Free / 1GB, 1) } } | Format-Table -AutoSize | Out-String
