@echo off
REM llama-server on the Vulkan backend - the card does the work, the two cores feed it.
REM Default model is the tiny smoke-test GGUF; pass another path as %1 when a bigger one is staged.
REM   -ngl 99      every layer on the GPU
REM   --no-mmap    safer on a box with 3.9 GB RAM and a 4 GB card
setlocal
set "LLAMA=C:\AI\llama\llama-server.exe"
set "MODEL=C:\AI\models\qwen2.5-0.5b-q4km.gguf"
if not "%~1"=="" set "MODEL=%~1"

cd /d C:\AI\llama
"%LLAMA%" -m "%MODEL%" --host 0.0.0.0 --port 8080 -ngl 99 -c 4096 --no-mmap
pause
