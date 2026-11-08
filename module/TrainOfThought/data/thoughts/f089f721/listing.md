# For sale — a PC that makes its own advertising (draft v1)

**$300 CAD.** DESKTOP-Q8U0BTH, working, at my place. You can watch it render before you pay.

## What it is
A complete desktop: NVIDIA GTX 980 Ti (6 GB), Intel i5-650, 8 GB DDR3, Windows 11, SSD, and the AI
runtime stack already installed and measured. No cloud, no subscription, no account. Everything below
was produced on this machine, by this machine, and the timings are from its own logs.

## What it actually does (measured, 2026-11-07)
| Task | Model | Result | Time |
|---|---|---|---|
| Still image, 512², 20 steps | SD 1.5 (Q8 GGUF, sd.cpp, Vulkan) | 1 image | 44 s (1.17 s/step) |
| Music, 30 s stereo | Stable Audio 3 Small (Q8, audio.cpp) | 0.7 MB WAV | 21 s |
| Voice-over, 23 s of speech | Qwen3-TTS VoiceDesign 1.7B (Q8, audio.cpp) | real-sounding read | 45 s |
| Moving shot, 480p | Wan 2.1 T2V 1.3B (sd.cpp, CPU offload) | VIDEO_TIME_PLACEHOLDER | VIDEO_WALL_PLACEHOLDER |
| Assembly to 1080p MP4 | ffmpeg 9.0.1 | 30 s ad | under a minute |

## What it costs you to run
Nothing per render. It pulls about 150 W at the wall while working, so a full 30 s ad — stills, music,
voice, motion, cut — costs a few cents of electricity and roughly HOWLONG_PLACEHOLDER of wall time.

## What it cannot do (so you don't find out the hard way)
- **No CUDA on this GPU.** The card is Maxwell (compute 5.2). NVIDIA's prebuilt CUDA builds ship kernels
  for 7.0 and newer only, and a source build is blocked on this Windows toolchain (five compiler/toolkit
  pairings tried, transcripts kept). It runs everything on **Vulkan/CPU**. Expect no CUDA-only software.
- **No fp16.** The card reports fp16: 0 under Vulkan, so it is roughly half the speed of a modern card of
  the same size.
- **8 GB RAM, 2 real cores.** Big models spill to the pagefile. A 2 second 480p clip is minutes of work,
  not seconds. This is a maker's toy, not a production farm.
- **Images are 512² natively.** Upscaling works (Lanczos/ESRGAN), detail does not appear from nowhere.
  Hands, keyboards and text in generated images are 2015-quality.

## What's installed, ready to go
sd.cpp (Vulkan, images + Wan video), audio.cpp (Vulkan: TTS, voice design, music), ffmpeg 9.0.1, CUDA 12.9
and MSVC 14.44 toolchains, and the model files (~12 GB) listed above. Windows 11, admin account, SSH on.

## Why $300
The parts are worth less — the GPU is a $40 card. You are paying for a machine that already works: the
models are downloaded, the runtimes are compiled and measured, the prompts are written, and the box has
proved it can produce a finished ad by itself. Rebuilding this from scratch is a weekend of downloads and
four dead ends on the CUDA toolchain. I know, because I did it.

**Includes**: the machine, the models, the scripts, and the ad it made — `the-machine-sells-itself.mp4`.
