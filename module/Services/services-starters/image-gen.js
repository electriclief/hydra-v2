// image-gen — a starter service (ships with Hydra by default)
// Comments may lead; the single data assignment follows. Loaded as DATA, never executed.
module.exports = {
  name: 'image-gen',
  version: '0.1.0',
  advert: {
    what: 'Generate an image from a prompt with stable-diffusion.cpp — the krea2 flow, done properly: pinned one-line command, aspect presets, a seed that rolls itself.',
    time: 'unknown until history exists — after runs: the average, or the last few run times',
    karma: 5,
  },
  provider: {
    name: 'stable-diffusion.cpp',
    repo: 'https://github.com/leejet/stable-diffusion.cpp',
    launch: 'sd -m {{model}} -p "{{prompt}}" -n "{{negative}}" -W {{width}} -H {{height}} -s {{steps}} --seed {{seed}} -o {{output}}',
    probe: 'sd --help',
    update: 'git pull and rebuild, or fetch the newest release — keep the same gguf models',
  },
  variables: {
    init: [
      { name: 'exeDir', label: 'stable-diffusion.cpp folder', type: 'text', default: 'C:/services/sd.cpp', help: 'Where sd (or sd.exe) lives. Move it freely and say so — the installer follows the user.' },
      { name: 'model', label: 'Model (GGUF file)', type: 'text', default: 'C:/services/models/sd15-q8_0.gguf' },
      { name: 'outDir', label: 'Output folder', type: 'text', default: 'C:/services/sd.cpp/output' },
    ],
    input: [
      { name: 'prompt', label: 'Prompt', type: 'textarea', required: true, full: true },
      { name: 'negative', label: 'Negative prompt', type: 'textarea', default: 'blurry, low quality', muted: true, full: true },
      { name: 'width', label: 'Width', type: 'number', default: 512, min: 64, max: 2048, step: 64 },
      { name: 'height', label: 'Height', type: 'number', default: 512, min: 64, max: 2048, step: 64 },
      { name: 'steps', label: 'Steps', type: 'number', default: 20, min: 1, max: 150 },
      { name: 'seed', label: 'Seed', type: 'number', default: -1, help: 'Set -1 and the seed rolls itself per run — pin a number to reproduce one.' },
      { name: 'aspect', label: 'Aspect preset', type: 'select', options: ['square 1:1', 'landscape 3:2', 'portrait 2:3', 'wide 16:9'], default: 'square 1:1', help: 'A convenience the page turns into width/height when the inputs are left alone.' },
    ],
    files: [],
  },
  modes: [
    {
      name: 'cuda-old-cards',
      fits: { sm: '50..61', note: 'Maxwell/Pascal — build with the old arch flag; generic builds may only carry newer sm kernels' },
      karma: 5,
      models: [
        { url: 'https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5', note: 'any SD1.5-era gguf works; Hydra will mirror and pin the file (sha256 on first fetch)' },
      ],
      install: {
        pins: { cuda: '11.8', cmake: '>=3.14' },
        sm: '52',
        steps: [
          'Build sd.cpp with the CUDA arch your card reports (e.g. -DCMAKE_CUDA_ARCHITECTURES=52) — or place an existing binary.',
          'Download a gguf model into C:/services/models.',
        ],
        fallback: ['C:/services/sd.cpp — the operator keeps built binaries for the old cards'],
        note: 'Old cards are first-class: the sm_XX build is the point — pick the mode that fits the silicon.',
      },
    },
    {
      name: 'vulkan-any',
      fits: { note: 'any Vulkan-capable GPU; least fuss, not always fastest' },
      karma: 5,
      install: {
        steps: ['Take the release build for your OS, or build with -DSD_VULKAN=ON.', 'Download a gguf model into C:/services/models.'],
      },
    },
    {
      name: 'cpu',
      fits: { note: 'no GPU — slow but honest; good for tiny proofs' },
      karma: 3,
      needs: { gpu: false, ramMb: 6000 },
      install: { steps: ['Same binary; no GPU flags.', 'Download a gguf model into C:/services/models.'] },
    },
  ],
  needs: { gpu: true, vramGb: 4, ramMb: 4000, cores: 4, diskGb: 2 },
  output: { kind: 'file', location: 'the output folder (outDir) — the .png lands there', description: 'one image per run; the seed used is printed' },
  update: { command: 'git pull && rebuild, or swap in the newer release binary', note: 'WHEN to update is the user\'s and Echidna\'s call — the how is declared right here.' },
  pages: {
    ad: `<style>
  .svc { font: 14px/1.6 system-ui, sans-serif; color: #d8dee9; background: #10141a; padding: 20px; max-width: 760px; }
  .svc h1 { font-size: 20px; margin: 0 0 2px; } .svc h2 { font-size: 15px; margin: 20px 0 6px; color: #9ecbff; }
  .svc .dim { color: #7b8794; } .svc pre { background: #1b232e; padding: 10px 12px; border-radius: 6px; overflow-x: auto; font: 12px/1.5 Consolas, monospace; white-space: pre-wrap; }
  .svc .k { background: #3b4a5c; padding: 1px 7px; border-radius: 10px; font-size: 12px; }
  </style>
  <div class="svc">
  <h1>Image Gen — stable-diffusion.cpp</h1>
  <p class="dim">starter service · ships with Hydra by default · the krea2 flow, pinned</p>
  <p>One prompt in, one image out. <b>Expected time:</b> from history — average of past runs or the last few; unknown until then. <b>Karma weight:</b> <span class="k">5</span> (relative; free at zero — its effect is queue priority, paid to the provider after use).</p>
  <h2>Install — the provider app (stable-diffusion.cpp)</h2>
  <pre>1. Fetch the release for your OS, or build from source.
2. Old cards: build with your CUDA arch (e.g. -DCMAKE_CUDA_ARCHITECTURES=52) — or take the vulkan build.
3. Older app? The cuda-old-cards mode in this file records which combo was built for old silicon.</pre>
  <h2>Install — the service (the model)</h2>
  <pre>Download a gguf model (SD1.5-era, q8_0 recommended for quality or q4 for size) into C:/services/models.
Hydra will mirror and pin the file on first fetch — the link above is the fallback.</pre>
  <h2>Update</h2>
  <pre>git pull and rebuild, or swap in the newer release binary. When is your call — the how is here.</pre>
  <h2>Beginner — you can do better</h2>
  <p>This page is the honest floor: one command, the inputs it takes, and where the image lands. Make your own service a better tour than this one.</p>
  </div>`,
    inputs: `<style>
  .svc { font: 14px/1.6 system-ui, sans-serif; color: #d8dee9; background: #10141a; padding: 20px; max-width: 760px; }
  .svc h1 { font-size: 20px; margin: 0 0 2px; } .svc pre { background: #1b232e; padding: 10px 12px; border-radius: 6px; overflow-x: auto; font: 12px/1.5 Consolas, monospace; white-space: pre-wrap; }
  .svc .dim { color: #7b8794; }
  </style>
  <div class="svc">
  <h1>The way in — the exact one-line command</h1>
  <p>Gathered here before the run; <b>the progress rides on this page</b> while it runs — a step line for each denoising step, the image at the end.</p>
  <pre>sd -m C:/services/models/sd15-q8_0.gguf -p "your prompt" -n "blurry, low quality" -W 512 -H 512 -s 20 --seed -1 -o C:/services/sd.cpp/output/img.png</pre>
  <p>Inputs: <b>prompt</b> · <b>negative</b> · <b>width/height</b> (or take an aspect preset) · <b>steps</b> · <b>seed</b> (-1 rolls itself; pin one to reproduce) · <b>output path</b> — defaulted; the instance keeps filenames fresh.</p>
  <p class="dim">The krea2 prompt maker lives beside this flow — make this page yours.</p>
  </div>`,
  },
  progress: { how: 'sd-cli prints a step line for each denoising step (step N of M) while the image forms', source: 'stdout' },
};
