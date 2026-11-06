// sd-cpp-zimage — Z-Image Turbo on stable-diffusion.cpp, this node (RX 6800 = Vulkan1).
// Comments may lead; the single data assignment follows. Loaded as DATA, never executed.
module.exports = {
  name: 'sd-cpp-zimage',
  version: '0.1.0',
  advert: {
    what: 'Fast still image on Z-Image Turbo (Q4_K, 4 steps). Verified on this node: the red-apple render came out on-prompt. The quick one — seconds of sampling once the model is staged.',
    time: 'this node measured 735s for a 4-step 512x512, but ~660s of that is staging the 3.9GB model off a slow disk (i7-2600). Sampling itself is seconds. A warm re-run is far quicker; a long batch pays staging once.',
    karma: 5,
  },
  provider: {
    name: 'stable-diffusion.cpp',
    repo: 'https://github.com/leejet/stable-diffusion.cpp',
    launch: 'D:/Models/sd-cpp/bin-master-929/sd-cli.exe --diffusion-model D:/Models/sd-cpp/Z-Image/z_image_turbo-Q4_K.gguf --vae D:/Models/sd-cpp/Z-Image/ae.safetensors --llm D:/Models/sd-cpp/Z-Image/Qwen3-4B-Instruct-2507-Q4_K_M.gguf --backend diffusion=vulkan1,vae=vulkan1,clip=vulkan1 --prompt-file {{promptFile}} -W {{width}} -H {{height}} --steps {{steps}} --cfg-scale 1.0 --seed {{seed}} -o {{output}}',
    probe: 'sd-cli.exe --list-devices',
    update: 'swap the release zip into D:/Models/sd-cpp/bin-master-929 and re-point the models junction at D:/Models/sd-cpp — keep the gguf models as they are',
  },
  variables: {
    init: [
      { name: 'sdDir', label: 'sd.cpp folder', type: 'text', default: 'D:/Models/sd-cpp/bin-master-929', help: 'The kit with sd-cli.exe in it. Master-929 (3f8527a) is what is installed here.' },
      { name: 'modelRoot', label: 'Model root', type: 'text', default: 'D:/Models/sd-cpp', help: 'The models junction points here, so the kit stays portable if the kit folder moves.' },
      { name: 'outDir', label: 'Output folder', type: 'text', default: 'D:/Models/sd-cpp/out' },
      { name: 'device', label: 'GPU (Vulkan index)', type: 'text', default: 'vulkan1', help: 'IMPORTANT: Vulkan0 is the GTX 1650 (4GB) on this box, Vulkan1 is the RX 6800 (16GB). Leave this on vulkan1 — the default picks the small card and renders fail or crawl.' },
    ],
    input: [
      { name: 'prompt', label: 'Prompt', type: 'textarea', required: true, full: true, help: 'Goes through --prompt-file, so quotes and odd characters cannot break the command line.' },
      { name: 'negative', label: 'Negative prompt', type: 'textarea', default: '', muted: true, full: true, help: 'Turbo models are distilled and run at cfg 1.0 — usually leave this empty.' },
      { name: 'width', label: 'Width', type: 'number', default: 512, min: 256, max: 2048, step: 64, help: 'PIXEL COUNT IS THE LEVER, not width. On a 16GB RX 6800 stay at or below ~590,000 pixels total. Safe: 512x512, 864x480 (fastest), and 1024x576 or 768x768 as the 16:9/square ceiling. OVER THE CLIFF at 786k+ (e.g. 1024x768): a real render on node 123 took 1160s PER STEP and ran 6.4 hours without saving an image.' },
      { name: 'height', label: 'Height', type: 'number', default: 512, min: 256, max: 2048, step: 64, help: 'Same law: width x height must stay under ~590k. The cliff is sharp, not gradual — 1.33x the pixels cost 96x the time.' },
      { name: 'steps', label: 'Steps', type: 'number', default: 4, min: 1, max: 50, help: 'Turbo is a distilled model — 4 is the intended setting, not a low-quality setting.' },
      { name: 'cfg', label: 'CFG scale', type: 'number', default: 1.0, min: 1, max: 8, step: 0.5, help: 'Turbo wants 1.0. The flag is --cfg-scale; plain --cfg is not a valid flag any more and dumps the help text.' },
      { name: 'seed', label: 'Seed', type: 'number', default: 42, help: 'sd-cli DEFAULTS to 42 when --seed is omitted — it is not random. Use -1 to roll a fresh one each run.' },
      { name: 'quality', label: 'Model quant', type: 'select', default: 'Q4_K (fast)', options: ['Q4_K (fast)', 'Q8_0 (best)'], help: 'Q4_K is 3.86GB and proven here. Q8_0 is 6.58GB — better detail, slower staging.' },
    ],
    files: [],
  },
  modes: [
    {
      name: 'turbo-q4k',
      fits: { note: 'the proven cell on this node — 512x512, 4 steps, all of it on the RX 6800' },
      karma: 5,
      models: [
        { url: 'https://huggingface.co/leejet/Z-Image-Turbo-GGUF/resolve/main/z_image_turbo-Q4_K.gguf', note: '3.86GB — on disk' },
        { url: 'https://huggingface.co/leejet/Z-Image-Turbo-GGUF/resolve/main/z_image_turbo-Q8_0.gguf', note: '6.58GB — on disk' },
        { url: 'https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf', note: '2.50GB text encoder — on disk' },
        { url: 'https://huggingface.co/black-forest-labs/FLUX.1-schnell/resolve/main/ae.safetensors', note: '335MB VAE — GATED repo, needs an HF token that has accepted the FLUX.1-schnell terms' },
      ],
      install: {
        steps: [
          'Take sd-cli.exe from the win-vulkan-x64 release zip (flat, not a bin/Release tree).',
          'The kit ships NO models folder — junction one: New-Item -ItemType Junction -Path <kit>\\models -Target D:/Models/sd-cpp',
          'Drop the four files above into D:/Models/sd-cpp/Z-Image.',
        ],
        fallback: ['The Comfy-Org flux1-schnell repack has an ungated ae.safetensors if the FLUX gate is a hassle.'],
        note: 'Vulkan device index matters more than anything else here.',
      },
    },
    {
      name: 'base-z-image',
      fits: { note: 'the non-distilled base model — slower and better, needs real step counts' },
      karma: 4,
      models: [
        { url: 'https://huggingface.co/unsloth/Z-Image-GGUF/resolve/main/z-image-Q4_K_M.gguf', note: '5.07GB — on disk' },
      ],
      install: { steps: ['Same kit. Raise steps to 20-30 and cfg to 4-6 for the base model — turbo numbers do not transfer.'] },
    },
  ],
  needs: { gpu: true, vramGb: 8, ramMb: 8000, cores: 2, diskGb: 8 },
  output: { kind: 'file', location: 'D:/Models/sd-cpp/out — one .png per run', description: 'a single PNG; the seed and the step count come back on stdout' },
  update: { command: 'swap in a newer win-vulkan-x64 release zip; keep the models junction', note: 'WHEN to update is the user\'s and Echidna\'s call — the how is declared right here.' },
  pages: {
    ad: `<style>
  .svc { font: 14px/1.6 system-ui, sans-serif; color: #d8dee9; background: #10141a; padding: 20px; max-width: 760px; }
  .svc h1 { font-size: 20px; margin: 0 0 2px; } .svc h2 { font-size: 15px; margin: 20px 0 6px; color: #9ecbff; }
  .svc .dim { color: #7b8794; } .svc pre { background: #1b232e; padding: 10px 12px; border-radius: 6px; overflow-x: auto; font: 12px/1.5 Consolas, monospace; white-space: pre-wrap; }
  .svc .k { background: #3b4a5c; padding: 1px 7px; border-radius: 10px; font-size: 12px; }
  .svc .warn { background: #3a2320; border-left: 3px solid #d08770; padding: 8px 12px; margin: 10px 0; }
  </style>
  <div class="svc">
  <h1>Z-Image Turbo — stills, fast</h1>
  <p class="dim">sd.cpp master-929 · RX 6800 (Vulkan1) · verified on this node</p>
  <p>The quick one. A distilled 4-step model that gives a usable image before you have finished reading this page. <b>Karma:</b> <span class="k">5</span></p>
  <h2>What is actually here</h2>
  <pre>z_image_turbo-Q4_K.gguf    3.86 GB   the one in use
z_image_turbo-Q8_0.gguf   6.58 GB   the quality pick
z-image-Q4_K_M.gguf       5.07 GB   the non-distilled base
Qwen3-4B-...-Q4_K_M.gguf  2.50 GB   text encoder
Qwen3-4B-...-Q8_0.gguf    4.28 GB   text encoder, full
ae.safetensors            0.34 GB   the VAE</pre>
  <h2>Two traps, both already handled for you</h2>
  <div class="warn"><b>Vulkan0 is the GTX 1650.</b> This box has two GPUs and the 1650 is 4GB. The default device picks it and everything crawls or dies. Every launch here pins <b>vulkan1</b> = the RX 6800.</div>
  <div class="warn"><b>--cfg is no longer a flag.</b> It is <b>--cfg-scale</b>. Passing --cfg makes sd-cli print its whole help text and exit without rendering — it looks like a hang, it is not.</div>
  <h2>Expect this to feel slow the first time</h2>
  <p>Measured here: <b>735s for a 4-step 512x512</b>. About 660s of that is staging the 3.86GB model off disk on an i7-2600 — the sampling is seconds. The sampler and VAE both stayed on the RX 6800 (VAE decode: 1984MB VRAM, single segment), so nothing spilled. A second run in the same session is much quicker; a big batch pays the staging once.</p>
  <h2>Beginner — you can do better</h2>
  <p>This is a floor, not a ceiling. Z-Image Turbo at 4 steps is the fastest honest image on this box; the interesting work is what you point it at.</p>
  </div>`,
    inputs: `<style>
  .svc { font: 14px/1.6 system-ui, sans-serif; color: #d8dee9; background: #10141a; padding: 20px; max-width: 760px; }
  .svc h1 { font-size: 20px; margin: 0 0 2px; } .svc pre { background: #1b232e; padding: 10px 12px; border-radius: 6px; overflow-x: auto; font: 12px/1.5 Consolas, monospace; white-space: pre-wrap; }
  .svc .dim { color: #7b8794; }
  </style>
  <div class="svc">
  <h1>The way in — Z-Image Turbo</h1>
  <p>Prompt, size, steps, seed. <b>The progress rides on this page</b> while it runs — a step line per denoising step, the image at the end.</p>
  <pre>cd D:/Models/sd-cpp/bin-master-929
sd-cli.exe --diffusion-model D:/Models/sd-cpp/Z-Image/z_image_turbo-Q4_K.gguf --vae D:/Models/sd-cpp/Z-Image/ae.safetensors --llm D:/Models/sd-cpp/Z-Image/Qwen3-4B-Instruct-2507-Q4_K_M.gguf --backend diffusion=vulkan1,vae=vulkan1,clip=vulkan1 --prompt-file &lt;prompt.txt&gt; -W 512 -H 512 --steps 4 --cfg-scale 1.0 --seed 42 -o D:/Models/sd-cpp/out/img.png</pre>
  <p>Your prompt goes in a <b>file</b>, not on the command line. That is not fussiness — it is the whole quoting class of bugs gone: quotes, ampersands and pipes in a prompt cannot desync a command line.</p>
  <p>Inputs: <b>prompt</b> · <b>width/height</b> · <b>steps</b> (4 for turbo) · <b>cfg</b> (1.0 for turbo) · <b>seed</b> (42 reproduces; -1 rolls a new one) · <b>quant</b>.</p>
  <p class="dim">Omitting --seed does NOT randomise — sd-cli defaults to 42.</p>
  </div>`,
  },
  progress: { how: 'sd-cli prints a sampling line per denoising step, then "save result image 0 ... (success)" and "N/N images saved"', source: 'stdout' },
};
