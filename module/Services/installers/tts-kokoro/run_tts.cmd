@echo off
title Hydra TTS :8100 - Kokoro
cd /d C:\AI\tts
"C:\AI\tts\venv\Scripts\python.exe" -u tts_server.py 2>&1 | powershell -NoProfile -Command "$input | Tee-Object -FilePath C:\AI\tts\tts.log"
