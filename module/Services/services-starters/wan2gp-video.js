// wan2gp-video — a starter service (ships with Hydra by default)
// Comments may lead; the single data assignment follows. Loaded as DATA, never executed.
module.exports = {
  name: 'wan2gp-video',
  version: '0.1.0',
  advert: {
    what: 'Generate video from a prompt — Wan2GP with quantized weights, built to survive low VRAM (6 GB and up).',
    time: 'unknown until history exists — video minutes per clip on big cards, much more on small ones; history will say',
    karma: 10,
  },
  provider: {
    name: 'Wan2GP',
    repo: 'https://github.com/deepbeepmeep/Wan2GP',
    launch: 'python wgp.py --prompt "{{prompt}}" --length {{frames}} --seed {{seed}}',
    probe: 'python wgp.py --help',
    update: 'git pull && pip install -r requirements.txt',
  },
  variables: {
    init: [
      { name: 'wgpDir', label: 'Wan2GP folder', type: 'text', default: 'C:/services/Wan2GP', help: 'Where the repo lives. Move it freely and say so — the installer follows the user.' },
      { name: 'pythonPath', label: 'Python used', type: 'text', default: 'python', help: 'The venv that holds the torch the dance picked.' },
    ],
    input: [
      { name: 'prompt', label: 'Prompt', type: 'textarea', required: true, full: true },
      { name: 'frames', label: 'Length (frames)', type: 'number', default: 49, min: 9, max: 241, step: 4 },
      { name: 'seed', label: 'Seed', type: 'number', default: -1, help: 'Set -1 and the seed rolls itself per run.' },
      { name: 'resolution', label: 'Resolution', type: 'select', options: ['480p', '720p'], default: '480p' },
    ],
    files: [
      { name: 'first-frame', kind: 'image (optional)', note: 'A slot plugs a FILE here — or a SERVICE that produces that file (the image-gen service can feed the first frame).' },
    ],
  },
  modes: [
    {
      name: 'low-vram-6gb',
      fits: { vramGbMin: '6', note: 'quantized weights are the whole trick — 6 GB class cards' },
      karma: 10,
      models: [
        { url: 'https://huggingface.co/Wan-AI', note: 'the Wan model the release asks for, quantized per its README; Hydra will mirror and pin it' },
      ],
      install: {
        pins: { python: '3.10', cuda: '11.8', torch: '2.5.1+cu118' },
        steps: [
          'THE DANCE first: a python whose wheels exist for the cuda of this card (3.10 / 3.11 for cu118) — create a venv.',
          'pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118  (the old-card cuda line)',
          'git clone https://github.com/deepbeepmeep/Wan2GP and pip install -r requirements.txt.',
          'Follow the repo README for the quantized weights download.',
        ],
        fallback: ['ask the operator — the old-card combo was worked out once'],
        note: 'Low VRAM is the whole point of this provider: take the quantized modes it offers and expect patience, not speed.',
      },
    },
    {
      name: 'high-vram-16gb',
      fits: { vramGbMin: '16', note: 'bigger cards — full precision, longer clips' },
      karma: 10,
      install: { pins: { python: '3.11+' }, steps: ['venv with a current python.', 'pip install torch (current cu wheel).', 'git clone the repo; pip install -r requirements.txt; fetch the full weights per README.'] },
    },
  ],
  needs: { gpu: true, vramGb: 6, ramMb: 16000, cores: 4, diskGb: 40 },
  output: { kind: 'file', location: 'the repo\'s output folder', description: 'an .mp4 per run; the seed used is printed' },
  update: { command: 'git pull && pip install -r requirements.txt', note: 'WHEN to update is the user\'s and Echidna\'s call — the how is declared right here. An update may move the dance — re-check the pins.' },
  pages: {
    ad: `<style>
  .svc { font: 14px/1.6 system-ui, sans-serif; color: #d8dee9; background: #10141a; padding: 20px; max-width: 780px; }
  .svc h1 { font-size: 20px; margin: 0 0 2px; } .svc h2 { font-size: 15px; margin: 20px 0 6px; color: #9ecbff; }
  .svc .dim { color: #7b8794; } .svc pre { background: #1b232e; padding: 10px 12px; border-radius: 6px; overflow-x: auto; font: 12px/1.5 Consolas, monospace; white-space: pre-wrap; }
  .svc .k { background: #3b4a5c; padding: 1px 7px; border-radius: 10px; font-size: 12px; }
  </style>
  <div class="svc">
  <h1>Video Gen — Wan2GP</h1>
  <p class="dim">starter service · ships with Hydra by default · built for small cards</p>
  <p>Prompt in, a short clip out — quantized and patient. <b>Expected time:</b> from history; video runs are slow, so the last runs matter more here than anywhere. <b>Karma weight:</b> <span class="k">10</span> (relative; free at zero — its effect is queue priority, paid to the provider after use).</p>
  <h2>Install — the provider app (Wan2GP)</h2>
  <pre>THE DANCE first (old cards especially):
1. python  a version whose wheels exist for the cuda you need (3.10 / 3.11 for cu118)
2. cuda    the line that still carries this card's kernels (11.8)
3. torch   pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
4. git clone https://github.com/deepbeepmeep/Wan2GP  &&  pip install -r requirements.txt
5. fetch the quantized weights per the repo README — quantization is what makes 6 GB viable.</pre>
  <h2>Install — the service (the model)</h2>
  <pre>The release README names the Wan weights and their quantized variants — download what the mode says.
Hydra will mirror and pin each file on first fetch; the HF link in the mode is the fallback.</pre>
  <h2>Update</h2>
  <pre>git pull && pip install -r requirements.txt     (an update may move the dance — re-check the pins)</pre>
  <h2>Honesty notes</h2>
  <p><b>Time:</b> a clip on a 6 GB card is not fast — expected times come from history, never from optimism. <b>Verdicts:</b> if it fails, the run's own log is the evidence — keep it.</p>
  </div>`,
    inputs: `<style>
  .svc { font: 14px/1.6 system-ui, sans-serif; color: #d8dee9; background: #10141a; padding: 20px; max-width: 780px; }
  .svc h1 { font-size: 20px; margin: 0 0 2px; } .svc pre { background: #1b232e; padding: 10px 12px; border-radius: 6px; overflow-x: auto; font: 12px/1.5 Consolas, monospace; white-space: pre-wrap; }
  .svc .dim { color: #7b8794; }
  </style>
  <div class="svc">
  <h1>The way in</h1>
  <p>Gathered here before the run; <b>the progress rides on this page</b> while it runs — video is slow and mostly quiet; the clip appears at the end.</p>
  <pre>python wgp.py --prompt "your prompt" --length 49 --seed -1</pre>
  <p>Inputs: <b>prompt</b> · <b>frames</b> (length) · <b>seed</b> · <b>resolution</b> · <b>output path</b> — defaulted; the instance keeps filenames fresh. Optional slot: an image as the <b>first-frame</b> — plug a file, or a service (image-gen) that produces one.</p>
  </div>`,
  },
  progress: { how: 'video renders frame by frame and is mostly silent — the clip appears at the end; the run log is the evidence', source: 'stdout' },
  gui: { kind: 'exe', value: 'the Wan2GP Desktop Launcher', note: 'the provider ships its own desktop app — the button follows it' },
};
