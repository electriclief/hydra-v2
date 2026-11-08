$ErrorActionPreference = 'SilentlyContinue'
$ev = Get-WinEvent -LogName 'Microsoft-Windows-PrintService/Operational' -MaxEvents 8
if ($ev) {
  foreach ($e in $ev) {
    $first = ($e.Message -split [char]10)[0]
    '{0}  id={1}  {2}' -f $e.TimeCreated.ToString('HH:mm:ss'), $e.Id, $first
  }
} else { 'PrintService operational log: off or empty' }
$spool = @(Get-ChildItem 'C:\Windows\System32\spool\PRINTERS' -ErrorAction SilentlyContinue)
'spool files now: ' + $spool.Count
$p = Get-Printer 'Brother DCP-L2550DW'
'printer: {0}  status={1}  jobs={2}' -f $p.Name, $p.PrinterStatus, (@(Get-PrintJob -PrinterName $p.Name).Count)
