# The .134 self-ad — script and shot list (v1)

Constraint that makes it interesting: every pixel and every sample in this file has to be produced on
DESKTOP-Q8U0BTH itself — GTX 980 Ti 6 GB (Maxwell, no fp16 path), i5-650, 7.9 GB RAM, Windows 11.
Nothing rendered elsewhere, nothing downloaded as a finished asset.

Length 30 s. 16:9. Black bars and white type, no logo, no stock footage.

## Voice-over (one take, qwen3_tts VoiceDesign, ~60 words ≈ 28 s)
> Forty dollars of graphics card. A fifteen year old i5. Eight gigabytes of RAM.
> This machine made this ad — the pictures, the voice, the music — on itself, by itself.
> It will do the same for you. Three hundred dollars, and it's yours.

Voice direction: a woman in her late twenties, close to the microphone, dry and matter-of-fact, no
salesmanship. Slight smile on the last line. (Same VoiceDesign path already measured at rtf 1.269.)

## Shots
| t | picture | source |
|---|---------|--------|
| 0.0-2.5 | black, white type: "We listed a PC for $300." | ffmpeg drawtext |
| 2.5-9.0 | still A: dark desk, tower with a red-lit fan, window light — slow push in | sd.cpp SD1.5 512² → upscale to 1080p |
| 9.0-15.0 | still B: close on the card / case light, shallow depth | sd.cpp SD1.5 512² |
| 15.0-21.0 | moving shot: slow drift through a dim neon room | sd.cpp Wan2.1 T2V 1.3B, 33 frames, 480p |
| 21.0-26.0 | still C: the machine's own output grid (thumbnail wall of what it made) | ffmpeg tile of the stills |
| 26.0-30.0 | price card: "$300 CAD" / "GTX 980 Ti · i5-650 · 8 GB" / "it renders its own ads" | ffmpeg drawtext |

## Audio bed
Stable Audio 3 Small (music) 30 s instrumental, mixed under the VO at about -18 dB, ducking not needed
if the bed is sparse. Prompt: slow cinematic synth pulse, warm analog bass, ticking percussion, hopeful
rising pad, instrumental, no vocals, room to breathe.

## Assembly
ffmpeg 9.0.1 (already installed): stills -> zoompan, Wan clip -> scale/pad, concat, VO + bed -> amix,
mux to h264/aac mp4. Every step is a command in the log, so the whole ad is reproducible from this file.

## Honesty rules for the listing
- The price is $300 CAD for the assembled machine; the card inside cost $40.
- Say what it cannot do: no fp16, no CUDA kernels for this arch (measured, five toolchain attempts),
  Vulkan only, and a 2 s 480p clip takes minutes, not seconds.
- The ad itself is the benchmark: every render time in the listing comes from this run's log.
