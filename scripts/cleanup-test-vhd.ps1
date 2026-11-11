# detach and delete the throwaway test VHD used for the installer layout test
$ErrorActionPreference = 'Continue'
$d = Get-Disk | Where-Object { $_.BusType -eq 'File Backed Virtual' }
foreach ($x in $d) {
  'disk {0}: {1}  location {2}' -f $x.Number, $x.FriendlyName, $x.Location
  $path = ($x.Location -replace '^.*?:\\', '')  # not reliable; use the known path
}
$vhd = 'C:\AI\work\installer-test.vhd'
$dp = 'C:\AI\work\dp2.txt'
"select vdisk file=`"$vhd`"`r`ndetach vdisk" | Out-File -FilePath $dp -Encoding ascii
& diskpart /s $dp | Select-Object -Last 4
Start-Sleep -Seconds 2
if (Test-Path $vhd) {
  try { Remove-Item $vhd -Force -ErrorAction Stop; 'vhd deleted' } catch { 'could not delete: ' + $_.Exception.Message }
} else { 'vhd already gone' }
'--- disks now'
Get-Disk | Select-Object Number, FriendlyName, @{ n = 'GB'; e = { [math]::Round($_.Size / 1GB, 1) } }, BusType | Format-Table -AutoSize | Out-String -Width 120 | Write-Host
