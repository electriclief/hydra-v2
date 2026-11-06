// llama-chat — a starter service (ships with Hydra by default)
// Comments may lead; the single data assignment follows. Loaded as DATA, never executed.
// The versions recorded here came from a real install trial on the 980ti node, 2026-09-23.
module.exports = {
  name: 'llama-chat',
  version: '0.1.0',
  advert: {
    what: 'Generate text from a prompt with llama.cpp — one-shot completions or chat on a GGUF model.',
    time: 'unknown until history exists — after runs: the average, or the last few run times',
    karma: 3,
  },
  provider: {
    name: 'llama.cpp',
    repo: 'https://github.com/ggml-org/llama.cpp',
    launch: 'llama-cli -m {{model}} -p "{{prompt}}" -n {{tokens}} -ngl {{ngl}}',
    probe: 'llama-cli --version',
    update: 're-run the install steps for the newest release — mind the nightly-tag.txt trap below',
  },
  variables: {
    init: [
      { name: 'exeDir', label: 'llama.cpp folder', type: 'text', default: 'C:/services/llama.cpp', help: 'Where the release zip was unpacked. Move it freely and say so — the installer follows the user.' },
      { name: 'model', label: 'Model (GGUF file)', type: 'text', default: 'C:/services/models/qwen2.5-0.5b-instruct-q4_k_m.gguf' },
    ],
    input: [
      { name: 'prompt', label: 'Prompt', type: 'textarea', required: true },
      { name: 'tokens', label: 'Max tokens', type: 'number', default: 256, min: 1, max: 4096, full: false },
      { name: 'ngl', label: 'GPU layers (-ngl)', type: 'number', default: 99, min: 0, max: 999, help: '99 = all layers on GPU; 0 = CPU only.', muted: true },
    ],
    files: [],
  },
  modes: [
    {
      name: 'cuda-old-cards',
      fits: { sm: '50..61', note: 'Maxwell/Pascal — the sm_XX build is the fast path; a hand-made sm_52 build ran fast where the generic vulkan release crawled' },
      karma: 3,
      models: [
        { url: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF', note: 'small pilot model; Hydra will mirror and pin it (sha256 on first fetch)' },
      ],
      install: {
        pins: { cuda: '11.8', cmake: '>=3.14' },
        sm: '52',
        steps: [
          'Build llama.cpp with -DCMAKE_CUDA_ARCHITECTURES=52 (the hand-made sm_52 build from the 980ti trial) — or place an existing binary.',
          'Download a GGUF model into C:/services/models.',
        ],
        fallback: ['the operator kept the sm_52 build — ask before rebuilding'],
        note: 'Old cards are first-class: pick the mode that fits yours. Recorded on the 980ti: vulkan 0.5 t/s warm vs CPU 3.7 t/s — the sm_52 CUDA build was the fast path.',
      },
    },
    {
      name: 'vulkan-any',
      fits: { note: 'any Vulkan-capable GPU; least fuss, not always fastest' },
      karma: 3,
      models: [
        { url: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF', note: 'small pilot model; Hydra will mirror and pin it' },
      ],
      install: {
        steps: [
          'Do NOT trust the release named latest: it holds only nightly-tag.txt (trial finding, 2026-09-23).',
          'Open that file — it names the real tag (the trial used b11146).',
          'Download win-vulkan-x64.zip (31 MB at b11146) from that tag and unpack to C:/services/llama.cpp.',
          'Download a GGUF model into C:/services/models.',
        ],
        fallback: ['C:/services/llama.cpp already installed on the 980ti node (2026-09-23)'],
        note: 'Measured slow on the 980ti warm — old cards should prefer their sm_XX CUDA mode.',
      },
    },
    {
      name: 'cpu',
      fits: { note: 'no GPU at all — works everywhere' },
      karma: 2,
      needs: { gpu: false, ramMb: 2000 },
      install: {
        steps: ['Same release zip; run with -ngl 0.', 'Download a GGUF model into C:/services/models.'],
      },
    },
  ],
  needs: { gpu: true, vramGb: 2, ramMb: 2000, cores: 2, diskGb: 1 },
  output: { kind: 'text', location: 'stdout', description: 'the generated text, plus llama.cpp timing lines' },
  update: { command: 'check nightly-tag.txt, fetch the newer win zip, swap the folder', note: 'WHEN to update is the user\'s and Echidna\'s call — the how is declared right here.' },
  pages: {
    ad: `<style>
  .svc { font: 14px/1.6 system-ui, sans-serif; color: #d8dee9; background: #10141a; padding: 20px; max-width: 760px; }
  .svc h1 { font-size: 20px; margin: 0 0 2px; } .svc h2 { font-size: 15px; margin: 20px 0 6px; color: #9ecbff; }
  .svc .dim { color: #7b8794; } .svc pre { background: #1b232e; padding: 10px 12px; border-radius: 6px; overflow-x: auto; font: 12px/1.5 Consolas, monospace; white-space: pre-wrap; }
  .svc .k { background: #3b4a5c; padding: 1px 7px; border-radius: 10px; font-size: 12px; }
  </style>
  <div class="svc">
  <h1>LLM Chat — llama.cpp</h1>
  <p class="dim">starter service · ships with Hydra by default</p>
  <p>Generate text from a prompt on a GGUF model. <b>Expected time:</b> from history — the average of past runs, or the last few; until runs exist, unknown is unknown. <b>Karma weight:</b> <span class="k">3</span> (relative; free at zero — its effect is queue priority, paid to the provider after use).</p>
  <h2>Install — the provider app (llama.cpp)</h2>
  <pre>1. Do NOT trust the release named "latest" — it holds only nightly-tag.txt (trial finding 2026-09-23).
2. Open nightly-tag.txt — it names the real tag (the trial used b11146).
3. Download win-vulkan-x64.zip (31 MB at b11146) and unpack to C:/services/llama.cpp.
   Old cards: build or fetch the sm_XX binary instead — the cuda-old-cards mode says how.</pre>
  <h2>Install — the service (the model)</h2>
  <pre>Download a GGUF model (the trial used qwen2.5-0.5b-instruct-q4_k_m.gguf, 469 MB) into C:/services/models.</pre>
  <h2>Update</h2>
  <pre>Check nightly-tag.txt again; fetch the newer zip; swap the folder. When is your call — the how is here.</pre>
  <h2>From the first real trial (980ti node, 2026-09-23)</h2>
  <p>Installed and generated end-to-end: GPU answered, CPU answered. Vulkan on the old card was slow warm (0.5 t/s); CPU was 3.7 t/s; the hand-made sm_52 CUDA build was the fast path. Old-card lesson: pick the mode that fits the silicon.</p>
  </div>`,
    inputs: `<style>
  .svc { font: 14px/1.6 system-ui, sans-serif; color: #d8dee9; background: #10141a; padding: 20px; max-width: 760px; }
  .svc h1 { font-size: 20px; margin: 0 0 2px; } .svc pre { background: #1b232e; padding: 10px 12px; border-radius: 6px; overflow-x: auto; font: 12px/1.5 Consolas, monospace; white-space: pre-wrap; }
  .svc .dim { color: #7b8794; }
  </style>
  <div class="svc">
  <h1>The way in — inputs to one command</h1>
  <p>Gathered here before the run; <b>the progress rides on this page</b> while it runs — tokens stream as they come.</p>
  <pre>llama-cli -m C:/services/models/qwen2.5-0.5b-instruct-q4_k_m.gguf -p "your prompt" -n 256 -ngl 99</pre>
  <p>Inputs: <b>prompt</b> (the text) · <b>tokens</b> · <b>ngl</b> (GPU layers: 99 = all on GPU, 0 = CPU only).</p>
  <p class="dim">This page is the honest floor — make it yours.</p>
  </div>`,
  },
  progress: { how: 'the server streams tokens as they are generated — the answer grows live', source: 'stdout' },
  gui: { kind: 'url', value: 'http://127.0.0.1:8080', note: 'llama-server serves its own web chat' },
};
