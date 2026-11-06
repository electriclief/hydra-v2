// sd-cpp-ltx25 — LTX-2.5 video (with audio) on stable-diffusion.cpp, this node (RX 6800 = Vulkan1).
// Comments may lead; the single data assignment follows. Loaded as DATA, never executed.
module.exports = {
  name: 'sd-cpp-ltx25',
  version: '0.1.0',
  advert: {
    what: 'LTX-2.5 video with a synchronized audio track — the only model in this collection that speaks. 22B, so it wants the 16GB card and patience. The build here (master-929) is new enough; the older 813 kit could not load it at all.',
    time: 'unknown until history exists — nothing has rendered on this node yet. A 22B transformer on an i7-2600 means minutes of staging before sampling even starts, and LTX samples in few steps but big ones.',
    karma: 3,
  },
  provider: {
    name: 'stable-diffusion.cpp',
    repo: 'https://github.com/leejet/stable-diffusion.cpp',
    launch: 'D:/Models/sd-cpp/bin-master-929/sd-cli.exe -M vid_gen --diffusion-model {{model}} --vae D:/Models/sd-cpp/LTX-2.5/ltx-2.5-video-vae-conv-bf16.safetensors --audio-vae D:/Models/sd-cpp/LTX-2.5/ltx-2.5-audio-vae-bf16.safetensors --llm {{clip}} --backend diffusion=vulkan1,vae=vulkan1,clip=vulkan1 --prompt-file {{promptFile}} --video-frames {{frames}} -W {{width}} -H {{height}} --steps {{steps}} --seed {{seed}} --fps {{fps}} -o {{output}}',
    probe: 'sd-cli.exe -h  (look for the ltx2 entry in the scheduler list)',
    update: 'swap the release zip into D:/Models/sd-cpp/bin-master-929 — LTX support moves fast, and older kits simply lack it',
  },
  variables: {
    init: [
      { name: 'sdDir', label: 'sd.cpp folder', type: 'text', default: 'D:/Models/sd-cpp/bin-master-929', help: 'master-929 (3f8527a) is installed. Anything older than ~master-881 has no LTX-2.5 support.' },
      { name: 'modelRoot', label: 'Model root', type: 'text', default: 'D:/Models/sd-cpp' },
      { name: 'outDir', label: 'Output folder', type: 'text', default: 'D:/Models/sd-cpp/out' },
      { name: 'clip', label: 'gemma4 text encoder', type: 'text', default: 'D:/Models/sd-cpp/LTX-2.5/gemma4-12b-with-proj-ltx-2.5-Q4_K_M.gguf', help: 'GATED — the repo needs an HF account that has accepted the terms. It goes in via --llm (it is a Gemma-architecture LLM, not a T5 — so NOT --t5xxl and NOT --clip, neither of which exists as a flag). NOT stock Gemma 4: the with-proj build is the one LTX-2.5 was trained against.' },
      { name: 'device', label: 'GPU (Vulkan index)', type: 'text', default: 'vulkan1', help: 'Vulkan0 is the GTX 1650 (4GB) here, Vulkan1 is the RX 6800 (16GB). Pin vulkan1.' },
    ],
    input: [
      { name: 'prompt', label: 'Prompt (describe picture AND sound)', type: 'textarea', required: true, full: true, help: 'LTX-2.5 is a video+audio model — say what you want to hear as well as see, in the same prompt.' },
      { name: 'firstFrame', label: 'First frame (image → video)', type: 'text', default: '', help: 'Empty = text-to-video. A full path starts from that image. --init-img takes the first, --end-img the last.' },
      { name: 'endFrame', label: 'End frame', type: 'text', default: '', help: 'Optional — pins the last frame of the clip.' },
      { name: 'model', label: 'Transformer', type: 'select', default: 'distilled Q4_K_M (start here)', options: ['distilled Q4_K_M (start here)', 'distilled Q2_K (small)', 'dev Q4_K_M (quality)'], help: 'Distilled runs in few steps and is the sane first try. Dev is the higher-quality weights and wants many more steps.' },
      { name: 'width', label: 'Width', type: 'number', default: 512, min: 256, max: 1280, step: 32, help: 'Rounds up to 32.' },
      { name: 'height', label: 'Height', type: 'number', default: 288, min: 256, max: 1280, step: 32 },
      { name: 'frames', label: 'Frames', type: 'number', default: 97, min: 9, max: 241, step: 8, help: 'Snaps to the 8n+1 grid. 97 frames at 24fps is about 4 seconds.' },
      { name: 'steps', label: 'Steps', type: 'number', default: 8, min: 1, max: 40, help: 'Distilled models are built for single digits. Going past ~12 on distilled buys nothing.' },
      { name: 'cfg', label: 'CFG scale', type: 'number', default: 1.0, min: 1, max: 8, step: 0.5, help: 'Distilled LTX wants 1.0. The flag is --cfg-scale; plain --cfg prints help text and exits.' },
      { name: 'seed', label: 'Seed', type: 'number', default: 42, help: 'sd-cli defaults to 42 when --seed is omitted — not random. -1 rolls a fresh one.' },
      { name: 'fps', label: 'FPS', type: 'number', default: 24, min: 8, max: 30, help: 'LTX-2.5 forces 24fps for the audio/video pairing — this is not a free choice like it is for video-only models.' },
      { name: 'audio', label: 'Audio track', type: 'select', default: 'yes (it is the point of this model)', options: ['yes (it is the point of this model)', 'no — video only'], help: 'Dropping --audio-vae gives you a silent clip. Everything else stays the same.' },
    ],
    files: [],
  },
  modes: [
    {
      name: 'distilled-q4k',
      fits: { note: 'the sane first run — few steps, the whole thing aimed at the 16GB card' },
      karma: 5,
      models: [
        { url: 'https://huggingface.co/vantagewithai/LTX-2.5-GGUF/resolve/main/distilled/ltx-2.5-22b-distilled-transformer-Q4_K_M.gguf', note: '15.69GB — on disk' },
        { url: 'https://huggingface.co/vantagewithai/LTX-2.5-GGUF/resolve/main/distilled/ltx-2.5-22b-distilled-transformer-Q2_K.gguf', note: '12.13GB — on disk, the smaller card option' },
        { url: 'https://huggingface.co/comfyicu/LTX-2.5/resolve/main/vae/ltx-2.5-video-vae-conv-bf16.safetensors', note: '1.45GB — on disk, and it MUST be the conv one' },
        { url: 'https://huggingface.co/comfyicu/LTX-2.5/resolve/main/vae/ltx-2.5-audio-vae-bf16.safetensors', note: '0.36GB — on disk' },
        { url: 'https://huggingface.co/elix3r/gemma4-12b-with-proj-ltx-2.5-GGUF/resolve/main/gemma4-12b-with-proj-ltx-2.5-Q4_K_M.gguf', note: '8.41GB text encoder — GATED, downloading' },
      ],
      install: {
        steps: [
          'sd-cli.exe from a release NEWER than master-881 — LTX-2.5 support landed 2026-08-20. master-929 is installed here.',
          'Junction the kit models folder at D:/Models/sd-cpp.',
          'The gemma4 encoder is gated: accept the terms on huggingface.co/elix3r/gemma4-12b-with-proj-ltx-2.5-GGUF, then fetch with an HF token.',
        ],
        fallback: ['comfyicu has an ungated gemma4 bf16 (26.26GB) — convert once to Q8 with sd-cli -M convert if the gate is a blocker.'],
        note: 'The conv VAE is not interchangeable with the plain one.',
      },
    },
    {
      name: 'dev-q4k',
      fits: { note: 'the higher-quality weights — many more steps, same hardware' },
      karma: 3,
      models: [
        { url: 'https://huggingface.co/vantagewithai/LTX-2.5-GGUF/resolve/main/dev/ltx-2.5-22b-dev-transformer-Q4_K_M.gguf', note: '15.69GB — on disk' },
      ],
      install: { steps: ['Raise steps to 20-30 — dev is not a distilled model and will not resolve in 8.'] },
    },
    {
      name: 'hq-upscale',
      fits: { note: 'two-stage: render, then refine through the latent spatial upscaler' },
      karma: 2,
      models: [
        { url: 'https://huggingface.co/comfyicu/LTX-2.5/resolve/main/latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors', note: '1.00GB — on disk' },
      ],
      install: { steps: ['Second pass through the upscaler after the base render. Doubles the cost per clip.'] },
    },
  ],
  needs: { gpu: true, vramGb: 16, ramMb: 32000, cores: 4, diskGb: 30 },
  output: { kind: 'file', location: 'D:/Models/sd-cpp/out — one clip per run, video + audio muxed', description: 'an .mp4 (or .avi) with a synchronized audio track unless audio is switched off' },
  update: { command: 'swap in a newer win-vulkan-x64 release zip; keep the models junction', note: 'LTX support is recent and still moving — re-check the release notes on every upgrade. WHEN is the user\'s and Echidna\'s call.' },
  pages: {
    ad: `<style>
  .svc { font: 14px/1.6 system-ui, sans-serif; color: #d8dee9; background: #10141a; padding: 20px; max-width: 760px; }
  .svc h1 { font-size: 20px; margin: 0 0 2px; } .svc h2 { font-size: 15px; margin: 20px 0 6px; color: #9ecbff; }
  .svc .dim { color: #7b8794; } .svc pre { background: #1b232e; padding: 10px 12px; border-radius: 6px; overflow-x: auto; font: 12px/1.5 Consolas, monospace; white-space: pre-wrap; }
  .svc .k { background: #3b4a5c; padding: 1px 7px; border-radius: 10px; font-size: 12px; }
  .svc .warn { background: #3a2320; border-left: 3px solid #d08770; padding: 8px 12px; margin: 10px 0; }
  .svc .good { background: #1e3328; border-left: 3px solid #7fb069; padding: 8px 12px; margin: 10px 0; }
  </style>
  <div class="svc">
  <h1>LTX-2.5 — video that comes with sound</h1>
  <p class="dim">sd.cpp master-929 · RX 6800 (Vulkan1) · 22B, the heavyweight in this collection</p>
  <p>Every other model here makes a silent clip. This one writes the audio track as part of the generation — the picture and the sound are made together, not bolted on. <b>Karma:</b> <span class="k">3</span></p>
  <h2>What is on the drive</h2>
  <pre>ltx-2.5-22b-distilled-Q4_K_M   15.69 GB   <-- the one to start on
ltx-2.5-22b-dev-Q4_K_M           15.69 GB   higher quality, many more steps
ltx-2.5-22b-distilled-Q2_K       12.13 GB   for a smaller card
ltx-2.5-video-vae-conv-bf16      1.45 GB   THE conv one — see below
ltx-2.5-audio-vae-bf16           0.36 GB   the sound
latent-spatial-upscaler-x2       1.00 GB   optional second pass
gemma4-12b-with-proj-Q4_K_M      8.41 GB   text encoder — was GATED, now fetching</pre>
  <h2>Three things that will waste your afternoon if you skip them</h2>
  <div class="warn"><b>The VAE must be the conv variant.</b> LTX also publishes a plain video VAE, and that one is an <i>unimplemented diffusion decoder</i> — it loads without complaint and produces noise. The file named <b>ltx-2.5-video-vae-conv-bf16</b> is the real one, and it is what is on the drive.</div>
  <div class="warn"><b>The text encoder is not stock Gemma 4.</b> It has to be the <b>with-proj</b> build. A plain Gemma 4 GGUF will not condition LTX-2.5 correctly, and it fails quietly rather than loudly.</div>
  <div class="warn"><b>The kit has to be new enough.</b> LTX-2.5 support landed around master-881 (2026-08-20). Older kits — including the master-813 that other fleet boxes still run — cannot load this model at all. This node has master-929.</div>
  <div class="good"><b>Vulkan0 is the GTX 1650 (4GB)</b> on this box and Vulkan1 is the RX 6800 (16GB). Every launch here pins <b>vulkan1</b>. A 22B model on the 1650 is not a slow render, it is a failed one.</div>
  <h2>Being honest about the cost</h2>
  <p>A 15.69GB transformer off this drive on an i7-2600 means a long, silent wait before the first step. Distilled at 8 steps, 512x288, 97 frames. Read the compute-buffer line in the log before you commit to anything bigger: one segment means it fit in VRAM, more than one means the graph spilled to CPU and the run will crawl. That line is the whole forecasting tool.</p>
  <h2>Beginner — you can do better</h2>
  <p>Video with sound is the reason this model exists. The floor is "it runs" — the interesting work is what you ask it to make.</p>
  </div>`,
    inputs: `<style>
  .svc { font: 14px/1.6 system-ui, sans-serif; color: #d8dee9; background: #10141a; padding: 20px; max-width: 760px; }
  .svc h1 { font-size: 20px; margin: 0 0 2px; } .svc pre { background: #1b232e; padding: 10px 12px; border-radius: 6px; overflow-x: auto; font: 12px/1.5 Consolas, monospace; white-space: pre-wrap; }
  .svc .dim { color: #7b8794; }
  </style>
  <div class="svc">
  <h1>The way in — LTX-2.5</h1>
  <p>One prompt for the picture <b>and</b> the sound. <b>The progress rides on this page</b> while it runs.</p>
  <pre>cd D:/Models/sd-cpp/bin-master-929
sd-cli.exe -M vid_gen --diffusion-model D:/Models/sd-cpp/LTX-2.5/ltx-2.5-22b-distilled-transformer-Q4_K_M.gguf --vae D:/Models/sd-cpp/LTX-2.5/ltx-2.5-video-vae-conv-bf16.safetensors --audio-vae D:/Models/sd-cpp/LTX-2.5/ltx-2.5-audio-vae-bf16.safetensors --llm D:/Models/sd-cpp/LTX-2.5/gemma4-12b-with-proj-ltx-2.5-Q4_K_M.gguf --backend diffusion=vulkan1,vae=vulkan1,clip=vulkan1 --prompt-file &lt;prompt.txt&gt; --video-frames 97 -W 512 -H 288 --steps 8 --cfg-scale 1.0 --seed 42 --fps 24 -o D:/Models/sd-cpp/out/clip.mp4</pre>
  <p>Your prompt goes in a <b>file</b>, not on the command line — quotes and pipes in a prompt cannot desync a command line. The encoder flag is <b>--llm</b> (gemma4 is an LLM, not a T5); there is no <b>--clip</b> flag to fall back on.</p>
  <p>Inputs: <b>prompt</b> (visual <i>and</i> audio) · <b>firstFrame</b> / <b>endFrame</b> (empty = text-to-video) · <b>model</b> · <b>width/height</b> (round up to 32) · <b>frames</b> (8n+1 grid) · <b>steps</b> (8 for distilled) · <b>cfg</b> (1.0) · <b>seed</b> · <b>fps</b> (24, forced) · <b>audio</b>.</p>
  <p class="dim">Omitting --seed does NOT randomise — sd-cli defaults to 42. Omitting --audio-vae drops the sound and nothing else changes.</p>
  </div>`,
  },
  progress: { how: 'sd-cli prints a sampling line per step, then the clip; the compute-buffer line up front says whether it fit in VRAM or spilled to CPU', source: 'stdout' },
};
