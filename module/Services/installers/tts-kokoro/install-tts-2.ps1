# install-tts-2.ps1 — Kokoro TTS on .149, take 2.
# Take 1 failed because ComfyUI's embedded python has no venv module. This machine HAS a real
# Python 3.10 (per-user install) — use that. Models are already downloaded (took 100 s).
$ErrorActionPreference = 'Continue'
$root = 'C:\AI\tts'
$venv = Join-Path $root 'venv'
$vp   = Join-Path $venv 'Scripts\python.exe'

$candidates = @(
  'C:\Users\user\AppData\Local\Programs\Python\Python310\python.exe',
  'C:\Users\user\AppData\Local\Programs\Python\Python311\python.exe',
  'C:\Users\user\AppData\Local\Programs\Python\Python312\python.exe'
)
$py = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $py) { Write-Output 'NO-REAL-PYTHON'; exit 1 }
Write-Output "base python: $py"

if (-not (Test-Path $vp)) {
  Write-Output '[1/4] creating venv'
  if (Test-Path $venv) { Remove-Item -Recurse -Force $venv }
  & $py -m venv $venv 2>&1 | Out-String | Write-Output
}
if (-not (Test-Path $vp)) { Write-Output 'VENV-FAILED'; exit 1 }
Write-Output "[2/4] venv python: $(& $vp -c 'import sys;print(sys.version.split()[0])')"

Write-Output '[3/4] pip install kokoro-onnx soundfile'
& $vp -m pip install --upgrade pip --quiet 2>&1 | Out-String | Write-Output
& $vp -m pip install kokoro-onnx soundfile 2>&1 | Select-Object -Last 8 | Out-String | Write-Output

Write-Output '[4/4] import check'
& $vp -c "import kokoro_onnx, soundfile, onnxruntime, sys; print('OK py', sys.version.split()[0], 'ort', onnxruntime.__version__)" 2>&1 | Out-String | Write-Output

Get-Item (Join-Path $root 'models\kokoro-v1.0.onnx'), (Join-Path $root 'models\voices-v1.0.bin') -ErrorAction SilentlyContinue |
  ForEach-Object { '{0}  {1:N0} MB' -f $_.Name, ($_.Length/1MB) }
Write-Output 'INSTALL2-DONE'
