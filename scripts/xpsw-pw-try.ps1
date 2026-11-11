$ErrorActionPreference='Continue'
$node='C:\AI\hydra-local\tools\node\node.exe'
'== is anything on 8125?'
Get-NetTCPConnection -State Listen -LocalPort 8125 -ErrorAction SilentlyContinue | ForEach-Object { '  pid ' + $_.OwningProcess }
'== run ProcessWrapper by hand for 15 s'
$out='C:\AI\hydra-local\logs\pw-try.out'; $err='C:\AI\hydra-local\logs\pw-try.err'
Remove-Item $out,$err -ErrorAction SilentlyContinue
$p = Start-Process -FilePath $node -ArgumentList @('public/js/main.js','--port','8125','--host','0.0.0.0') -WorkingDirectory 'C:\AI\hydra-local\module\ProcessWrapper' -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 15
'  exited: ' + $p.HasExited + '  code: ' + $(if($p.HasExited){$p.ExitCode}else{'running'})
'  listening 8125: ' + [bool](Get-NetTCPConnection -State Listen -LocalPort 8125 -ErrorAction SilentlyContinue)
'== stdout'; if (Test-Path $out) { Get-Content $out -Tail 15 | ForEach-Object { '  | ' + ($_ -replace '\s+',' ').Trim() } }
'== stderr'; if (Test-Path $err) { Get-Content $err -Tail 15 | ForEach-Object { '  ! ' + ($_ -replace '\s+',' ').Trim() } }
if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue; '  (stopped the test instance)' }
'PW TRY DONE'
