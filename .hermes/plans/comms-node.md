# Comms node — Jims Laptop prototype (outline, before code)

Jims Laptop (192.168.1.115, DESKTOP-DC6TMU5) is the prototype because it is the cheapest box in the fleet:
GTX 1050 2 GB, no ffmpeg, no python, declared `headless: true`, and it already boots Hydra by itself. If the comms
node works there it works anywhere.

## The shape: four capabilities, one trigger, five small doors

    port  door         what it owns                                             lazy child
    8160  CommsNode    the face: device inventory, one call that does the        none (proxies)
                       whole loop (listen -> transcribe -> answer -> speak),
                       and node.<ref>.comms published into State
    8161  AudioIn      microphone: 16 kHz mono WAV, a ring buffer of the last      ffmpeg -f dshow
                       N seconds, chunked stream for an external STT, RMS level
    8162  VideoIn      camera: MJPEG stream + single-frame snapshot               ffmpeg -f dshow
                       source is a local webcam OR an ipwebcam-style URL
    8163  AudioOut     text -> speech -> the speakers; also plays any stream      piper (SAPI fallback)
                       URL or raw WAV, so an external TTS can drive it            + ffplay
    8164  WakeWord     "Are you listening": System.Speech grammar, always on,     none (in-process)
                       fires POST /api/listen on the hub when it hears the phrase

Audio in and video in are separate doors on purpose: they are separate devices with separate failures, and a
camera that dies must not take the microphone with it. The hub is what makes them look like one node.

## Why these engines (and not others)

    ffmpeg static     one binary gives capture, resample, encode and playback; no python, no native npm module
    whisper.cpp       tiny.en for STT; the skill's measurements say a 2-core box transcribes slower than realtime,
                      so STT is a batch step behind the trigger, never a continuous stream
    piper             the workhorse TTS (RTF ~0.5 on a weak CPU); SAPI is the fallback that always answers
    System.Speech     the wake word. A model-based KWS would need whisper per 2 s chunk = 2x realtime on this
                      laptop, i.e. never catches up. A fixed grammar is instant and needs no weights.

## Lazy load rules

- A door starts in milliseconds and owns nothing but an inventory. It spawns ffmpeg / whisper / piper **on request**
  and kills it after `idleMs` (default 30 s), so an idle comms node costs ~40 MB and no CPU.
- Every spawned engine is a **ProcessWrapper row** (`comms-mic`, `comms-cam`, `comms-say`, `comms-stt`) so it appears
  in the app with a close button — never a loose background process.
- A capability that cannot start answers a **typed absence** (`no_mic`, `no_camera`, `stt_missing`, `tts_missing`)
  with the reason and the path it looked for. It never invents a device or returns silence as success.
- The hub holds no device state of its own: it asks the doors. Killing a door degrades the hub honestly.

## Contract between the doors

    GET  /api/devices              -> { mic:[...], speakers:[...], cameras:[...] }   (from ffmpeg -list_devices)
    POST /api/listen {seconds, stt}-> { ok, transcript, rms, ms, engine }            (AudioIn + whisper)
    GET  /api/audio?since=<ms>     -> audio/wav chunk stream                          (AudioIn)
    GET  /api/video                -> multipart/x-mixed-replace MJPEG                 (VideoIn)
    GET  /api/snapshot             -> image/jpeg                                      (VideoIn)
    POST /api/say {text, voice}    -> audio/wav, x-tts-provider header                (AudioOut)
    POST /api/play {url|wav}       -> 202, plays on the speakers                      (AudioOut)
    POST /api/listen (hub)         -> the full loop: wake -> capture -> stt -> answer -> speak
    GET  /api/state                -> what the node is doing, for State / Menu

## Test plan (no human required)

1. inventory: `GET /api/devices` names a real mic, speaker and camera (or says which is missing and why).
2. mic: 3 s capture, report RMS and peak — a dead mic reads 0.0 and is reported as `silent`, not success.
3. wake word: synthesize "Are you listening" with piper, feed it to the matcher in file mode -> detection fires.
4. TTS out: say a sentence, time it, report the provider (piper or sapi) and RTF.
5. STT: feed that same wav to whisper, print the transcript next to the text that was spoken.
6. video: snapshot exists and is a JPEG of the expected size; MJPEG stream returns frames.
7. the whole loop: `POST /api/listen` with a wav file standing in for the microphone -> transcript -> answer.

## What this does not do yet

- no always-on cloud STT; the trigger starts a bounded capture (default 8 s) exactly like v1 did
- no speaker diarisation, no echo cancellation: the laptop's speakers will be heard by its own mic
- the camera is whatever Windows enumerates; an ipwebcam URL is supported but untested until a phone is pointed at it
