# What this box has for a video job: GPU, builds, models, git, and what is mid-download.
$ErrorActionPreference = 'SilentlyContinue'

'== gpu'
Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion, @{n='VRAM_GB';e={[math]::Round($_.AdapterRAM/1GB,1)}} | Format-Table -AutoSize | Out-String | Write-Output
nvidia-smi --query-gpu=name,memory.total,driver_version,compute_cap --format=csv,noheader 2>&1 | Write-Output

'== ram / disk'
$os = Get-CimInstance Win32_OperatingSystem
'RAM total {0:N1} GB, free {1:N1} GB' -f ($os.TotalVisibleMemorySize/1MB), ($os.FreePhysicalMemory/1MB)
Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used } | ForEach-Object {
  '{0}: used {1:N1} GB, free {2:N1} GB' -f $_.Name, ($_.Used/1GB), ($_.Free/1GB)
}

'== C:\AI tree (top level)'
Get-ChildItem C:\AI -Directory | Select-Object -ExpandProperty Name | Write-Output

'== sd.cpp builds'
Get-ChildItem C:\ -Filter sd-cli.exe -Recurse -Depth 4 -File | Select-Object FullName, @{n='MB';e={[math]::Round($_.Length/1MB,1)}} | Format-Table -AutoSize | Out-String | Write-Output

'== models (gguf / safetensors / part), biggest first'
Get-ChildItem C:\ -Recurse -Depth 5 -File -Include *.gguf, *.safetensors, *.part |
  Sort-Object Length -Descending | Select-Object -First 20 @{n='GB';e={[math]::Round($_.Length/1GB,2)}}, FullName |
  Format-Table -AutoSize | Out-String | Write-Output

'== anything still downloading (curl/hf/node in flight)'
Get-Process | Where-Object { $_.ProcessName -match 'curl|hf|python|node' } |
  Select-Object ProcessName, Id, @{n='CPU_s';e={[math]::Round($_.CPU,0)}} | Format-Table -AutoSize | Out-String | Write-Output

'== git'
if (Test-Path C:\AI\hydra-local\.git) {
  Push-Location C:\AI\hydra-local
  'branch: ' + (git rev-parse --abbrev-ref HEAD 2>&1)
  'head:   ' + (git log --oneline -1 2>&1)
  'dirty:  ' + (@(git status --porcelain 2>&1).Count) + ' files'
  Pop-Location
} else { 'no checkout at C:\AI\hydra-local' }

'== ffmpeg / python'
foreach ($b in 'ffmpeg', 'python', 'python3') {
  $c = Get-Command $b -ErrorAction SilentlyContinue
  if ($c) { '{0}: {1}' -f $b, $c.Source } else { '{0}: missing' -f $b }
}
