// comfyui-workflow — a starter service (ships with Hydra by default)
// Comments may lead; the single data assignment follows. Loaded as DATA, never executed.
// The version dance recorded below is the point of this file: python · cuda · torch must
// line up so the wheel still carries the kernels an older card actually has.
module.exports = {
  name: 'comfyui-workflow',
  version: '0.1.0',
  advert: {
    what: 'Run a ComfyUI workflow (API-format json) — the heavy one: MiniMax-H3 video, big images, whatever the workflow declares.',
    time: 'unknown until history exists — video workflows are the slowest thing in the house; the run history will show it',
    karma: 8,
  },
  provider: {
    name: 'ComfyUI',
    repo: 'https://github.com/comfy-org/comfyui',
    launch: 'python main.py --listen {{host}} --port {{port}}',
    probe: 'python main.py --help',
    update: 'git pull && pip install -r requirements.txt',
  },
  variables: {
    init: [
      { name: 'comfyDir', label: 'ComfyUI folder', type: 'text', default: 'C:/services/ComfyUI', help: 'Where the repo was cloned. Move it freely and say so — the installer follows the user.' },
      { name: 'pythonPath', label: 'Python used', type: 'text', default: 'python', help: 'The interpreter of the venv that has the right torch — the dance lives here.' },
      { name: 'host', label: 'Bind host', type: 'text', default: '127.0.0.1', muted: true },
      { name: 'port', label: 'Port', type: 'number', default: 8188, muted: true },
    ],
    input: [
      { name: 'prompt', label: 'Prompt (workflow override)', type: 'textarea', help: 'Filled into the workflow\'s positive node when the workflow json exposes it.', full: true },
      { name: 'batch', label: 'Batch size', type: 'number', default: 1, min: 1, max: 16 },
    ],
    files: [
      { name: 'workflow', kind: 'json — ComfyUI API format', note: 'The workflow IS the service\'s contract. A slot plugs a FILE here — or a SERVICE that produces that file.' },
    ],
  },
  modes: [
    {
      name: 'cuda-cu118-old-cards',
      fits: { sm: '50..61', note: 'Maxwell/Pascal — the cu118 torch line is the one whose wheels still carry kernels for these cards' },
      karma: 8,
      models: [
        { url: 'https://huggingface.co/Wan-AI', note: 'the models your workflow names (AnimateDiff/Wan/H3-era checkpoints — the workflow json says exactly which); Hydra will mirror and pin each file it fetches' },
      ],
      install: {
        pins: { python: '3.10', cuda: '11.8', torch: '2.5.1+cu118' },
        steps: [
          'THE DANCE, in order: choose the python the wheels still exist for (3.10 or 3.11) — create a venv with it.',
          'Install torch for the cuda that matches the card: pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118',
          'Check it: python -c "import torch; print(torch.cuda.get_device_name(0))" — if the card is not there, the dance is wrong, fix it before ComfyUI.',
          'git clone https://github.com/comfy-org/comfyui and pip install -r requirements.txt inside the venv.',
          'Drop the models your workflow names into the models/ folders.',
        ],
        fallback: ['ask the operator — the old-card venv combo was worked out once and is worth keeping'],
        note: 'Same dance as everywhere: python · cuda · torch must line up. When an old card stops working after an update, it is almost always this line that moved.',
      },
    },
    {
      name: 'cuda-current',
      fits: { sm: '61+', note: 'Pascal refresh and newer — current wheels are fine' },
      karma: 8,
      install: {
        pins: { python: '3.11+' },
        steps: ['Create a venv with a current python.', 'pip install torch (current cu wheel) per the ComfyUI README.', 'git clone the repo; pip install -r requirements.txt; drop the models in.'],
      },
    },
    {
      name: 'cpu',
      fits: { note: 'no GPU — proof-only; a video workflow will crawl' },
      karma: 4,
      needs: { gpu: false, ramMb: 12000, diskGb: 20 },
      install: { steps: ['Same repo; torch CPU wheel (--index-url https://download.pytorch.org/whl/cpu).'] },
    },
  ],
  needs: { gpu: true, vramGb: 6, ramMb: 12000, cores: 4, diskGb: 20 },
  output: { kind: 'file', location: 'ComfyUI/output/ — images and videos land there', description: 'whatever the workflow emits per run (video, images), plus the run\'s node timings' },
  update: { command: 'git pull && pip install -r requirements.txt', note: 'WHEN to update is the user\'s and Echidna\'s call — the how is declared right here. Updates are also when the version dance moves — re-check the pins.' },
  pages: {
    ad: `<style>
  .svc { font: 14px/1.6 system-ui, sans-serif; color: #d8dee9; background: #10141a; padding: 20px; max-width: 780px; }
  .svc h1 { font-size: 20px; margin: 0 0 2px; } .svc h2 { font-size: 15px; margin: 20px 0 6px; color: #9ecbff; }
  .svc .dim { color: #7b8794; } .svc pre { background: #1b232e; padding: 10px 12px; border-radius: 6px; overflow-x: auto; font: 12px/1.5 Consolas, monospace; white-space: pre-wrap; }
  .svc .k { background: #3b4a5c; padding: 1px 7px; border-radius: 10px; font-size: 12px; }
  </style>
  <div class="svc">
  <h1>Workflow Runner — ComfyUI</h1>
  <p class="dim">starter service · ships with Hydra by default · the one with the version dance</p>
  <p>Feed it a workflow (API-format json) plus a prompt override; it runs the graph and lands the outputs in ComfyUI/output/. <b>Expected time:</b> from history — a video workflow is the slowest thing in the house; the last runs will say how slow. <b>Karma weight:</b> <span class="k">8</span> (relative; free at zero — its effect is queue priority, paid to the provider after use).</p>
  <h2>Install — the provider app (ComfyUI), old cards first</h2>
  <pre>THE DANCE — python, cuda, torch, in that order:
1. python   choose a version whose wheels still exist for the cuda you need (3.10 / 3.11 for cu118)
2. cuda     match the card — an old card wants the cuda line that still carries its sm_XX kernels (11.8)
3. torch    pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
   then check BEFORE continuing:  python -c "import torch; print(torch.cuda.get_device_name(0))"
4. git clone https://github.com/comfy-org/comfyui  &&  pip install -r requirements.txt</pre>
  <p class="dim">The cuda-cu118-old-cards mode pins the exact combo that still has wheels for Maxwell/Pascal. When an old card breaks after an update, it is almost always this dance that moved — re-check the pins.</p>
  <h2>Install — the service (the workflow + its models)</h2>
  <pre>The workflow json IS the service contract — it names exactly which model files it needs.
Drop those models into ComfyUI/models/... ; Hydra will mirror and pin each file it fetches.</pre>
  <h2>Update</h2>
  <pre>git pull && pip install -r requirements.txt     (updates move the dance too — re-check the pins)</pre>
  </div>`,
    inputs: `<style>
  .svc { font: 14px/1.6 system-ui, sans-serif; color: #d8dee9; background: #10141a; padding: 20px; max-width: 780px; }
  .svc h1 { font-size: 20px; margin: 0 0 2px; } .svc pre { background: #1b232e; padding: 10px 12px; border-radius: 6px; overflow-x: auto; font: 12px/1.5 Consolas, monospace; white-space: pre-wrap; }
  .svc .dim { color: #7b8794; }
  </style>
  <div class="svc">
  <h1>The way in</h1>
  <p>Gathered here before the run; <b>the progress rides on this page</b> while it runs — the graph reports each node as it finishes.</p>
  <pre>python main.py --listen 127.0.0.1 --port 8188          (start the provider)
curl -X POST http://127.0.0.1:8188/prompt -d @workflow.json   (queue the run)
the results land in ComfyUI/output/ — the workflow's own nodes print timings</pre>
  <p>Inputs: <b>workflow</b> (the json — the contract of the run) · <b>prompt</b> (override for the workflow's positive node) · <b>batch</b> · <b>output path</b> — defaulted; the instance keeps filenames fresh.</p>
  </div>`,
  },
  progress: { how: 'ComfyUI reports progress while the graph executes (each node as it finishes); the workflow prints timings at the end', source: 'http' },
  gui: { kind: 'url', value: 'http://127.0.0.1:8188', note: 'ComfyUI serves its own graph UI' },
};
