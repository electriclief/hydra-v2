# stop an in-flight make-installer-drive run on this box
$procs = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -like '*make-installer-drive*' }
if (-not $procs) { 'nothing running' }
foreach ($p in $procs) {
  'killing {0}: {1}' -f $p.ProcessId, $p.CommandLine.Substring(0, [math]::Min(90, $p.CommandLine.Length))
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 1
'--- disks now'
Get-Disk | Select-Object Number, FriendlyName, @{ n = 'GB'; e = { [math]::Round($_.Size / 1GB, 1) } }, PartitionStyle | Format-Table -AutoSize | Out-String -Width 120 | Write-Host
