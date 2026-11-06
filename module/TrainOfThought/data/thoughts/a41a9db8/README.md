# Wrap the voice engine as a Hydra V2 service

Measured on the GTX 980 Ti, warm: RTF 0.70-0.85 for qwen3_tts 1.7B VoiceDesign Q8. Faster than realtime on a 2014
card, which makes this a service rather than a script.

## What makes it a service and not a command
The install face (schema 2), the three character instructions kept in files, the RTF recorded as evidence, and the
Menu/Scheduler path so nobody has to know the CLI.
