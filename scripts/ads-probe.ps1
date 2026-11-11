param([switch]$Run)

# The 980 Ti's video path: what is resident, what the last attempt said, the exact command,
# and (with -Run) launch it detached so an ssh drop cannot kill a render.
$ErrorActionPreference = 'SilentlyContinue'
$ads   = 'C:\AI\ads'
$sd    = 'C:\AI\sd'
$wan   = 'C:\AI\sd\models\wan'
$log   = Join-Path $ads 'probe-980ti.log'
$cmd   = Join-Path $ads 'probe-980ti.cmd'
$out   = Join-Path $ads 'probe-980ti.webm'

'== ram in use (top 8)'
Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 8 ProcessName, @{n='MB';e={[math]::Round($_.WorkingSet64/1MB,0)}} |
  Format-Table -AutoSize | Out-String | Write-Output
$os = Get-CimInstance Win32_OperatingSystem
'RAM free now: {0:N1} GB of {1:N1} GB' -f ($os.FreePhysicalMemory/1MB), ($os.TotalVisibleMemorySize/1MB)

'== the ad folder'
Get-ChildItem $ads | Select-Object Name, @{n='KB';e={[math]::Round($_.Length/1KB,1)}}, LastWriteTime |
  Format-Table -AutoSize | Out-String | Write-Output

'== what the last attempt said (last 8 lines each)'
foreach ($f in 'wan.log', 'wan2.log', 'wan-dl.log') {
  $p = Join-Path $ads $f
  if (Test-Path $p) {
    '--- ' + $f
    Get-Content $p -Tail 8 | Write-Output
  }
}
$shots = Get-ChildItem $ads -Filter '*.avi' -ErrorAction SilentlyContinue
if ($shots) { '--- clips: ' + (($shots | ForEach-Object { '{0} ({1:N0} KB)' -f $_.Name, ($_.Length/1KB) }) -join ', ') }

'== the probe command'
$argLine = @(
  '-M vid_gen',
  "--diffusion-model `"$wan\wan2.1_t2v_1.3B_fp16.safetensors`"",
  "--vae `"$wan\wan_2.1_vae.safetensors`"",
  "--t5xxl `"$wan\umt5-xxl-encoder-Q4_K_M.gguf`"",
  '-p "a 1977 arcade cabinet in a dim garage, dust in the light, slow push in, warm tungsten glow"',
  '-n "text, watermark, logo, blurry, low contrast"',
  '--cfg-scale 6.0 --sampling-method euler --steps 8 --flow-shift 3.0',
  '-W 480 -H 272 --video-frames 17',
  # the encoder is 3.4 GB and this box has 8 GB of RAM: keep it on the CPU, keep the 2.6 GB DiT on the
  # card (6 GB is plenty for it) and tile the VAE decode, which is the stage the last run died in.
  '--backend clip=cpu --vae-tiling',
  '--seed 42',
  "-o `"$out`""
) -join ' '

$body = @"
@echo off
cd /d $sd
echo === probe start %DATE% %TIME% > "$log"
"$sd\sd-cli.exe" $argLine >> "$log" 2>&1
echo === exit %ERRORLEVEL% at %TIME% >> "$log"
"@
Set-Content -Path $cmd -Value $body -Encoding ASCII
'wrote ' + $cmd
$body

if ($Run) {
  '== launching detached (WMI, so an ssh drop cannot kill it)'
  if (Test-Path $out) { Remove-Item $out -Force }
  $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = "cmd.exe /c `"$cmd`"" }
  'process id {0} return {1}' -f $r.ProcessId, $r.ReturnValue
  Start-Sleep -Seconds 12
  'log so far:'
  if (Test-Path $log) { Get-Content $log -Tail 15 | Write-Output } else { 'no log yet' }
}
