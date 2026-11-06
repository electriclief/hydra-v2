@echo off
REM YuE studio launcher for the hydra-local instance (node 123).
REM Mirrors "1 - START STUDIO.bat" in Desktop\make_music, without the banner/pause.
REM The env vars are load-bearing: HF cache location, expandable segments, sdpa attention.
cd /d C:\AI\YuE
set PYTHONPATH=
set HF_HOME=C:/AI/hf-cache
set HF_HUB_DISABLE_XET=1
set PYTORCH_HIP_ALLOC_CONF=expandable_segments:True
set PYTHONUTF8=1
set YUE_ATTENTION_BACKEND=sdpa
"C:\AI\yue-venv\Scripts\python.exe" -u C:\AI\YuE\gui\yue_gui.py
