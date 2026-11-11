# Smoke pre-flight for the 980 Ti: can the binary run, which backend, and are the three Wan files present.
$ErrorActionPreference = 'SilentlyContinue'

'== binaries'
foreach ($exe in 'C:\AI\sd\sd-cli.exe', 'C:\Users\User\sd-master-982\sd-cli.exe') {
  if (Test-Path $exe) {
    $v = (Get-Item $exe).VersionInfo.FileVersion
    $size = [math]::Round((Get-Item $exe).Length / 1MB, 2)
    '{0}  {1} MB  ver {2}' -f $exe, $size, $v
  }
}

'== runtime dlls beside the build'
Get-ChildItem 'C:\AI\sd' -Filter *.dll | Select-Object Name, @{n='MB';e={[math]::Round($_.Length/1MB,1)}} | Format-Table -AutoSize | Out-String | Write-Output

'== sd-cli --list-devices (the real test: silent exit -1073741515 = missing VC++ runtime)'
$out = & 'C:\AI\sd\sd-cli.exe' --list-devices 2>&1
'last exit code: ' + $LASTEXITCODE
$out | Select-Object -First 20 | Write-Output

'== the three files a Wan2.1 T2V run needs'
$need = @(
  'C:\AI\sd\models\wan\wan2.1_t2v_1.3B_fp16.safetensors',
  'C:\AI\sd\models\wan\wan_2.1_vae.safetensors',
  'C:\AI\sd\models\wan\umt5-xxl-encoder-Q4_K_M.gguf',
  'C:\Models\wan21\wan_2.1_vae.safetensors',
  'C:\Models\wan21\wan2.1_t2v_1.3B_fp16.safetensors'
)
foreach ($f in $need) {
  if (Test-Path $f) { 'HAVE  {0}  {1:N2} GB' -f $f, ((Get-Item $f).Length / 1GB) }
  else { 'MISS  {0}' -f $f }
}

'== every wan-ish file anywhere shallow'
Get-ChildItem C:\ -Recurse -Depth 4 -File -Include *wan*, *umt5*, *vae*.safetensors |
  Select-Object @{n='GB';e={[math]::Round($_.Length/1GB,2)}}, FullName | Format-Table -AutoSize | Out-String | Write-Output

'== the ad project, if it exists'
if (Test-Path C:\AI\ads) {
  Get-ChildItem C:\AI\ads -Recurse -Depth 2 -File | Select-Object -First 25 @{n='KB';e={[math]::Round($_.Length/1KB,0)}}, FullName |
    Format-Table -AutoSize | Out-String | Write-Output
} else { 'no C:\AI\ads' }
