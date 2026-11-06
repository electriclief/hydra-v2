// hermes-agent-run — a starter service (ships with Hydra by default)
// Comments may lead; the single data assignment follows. Loaded as DATA, never executed.
module.exports = {
  name: 'hermes-agent-run',
  version: '0.1.0',
  advert: {
    what: 'Run the agent itself: a yolo desktop session, or a one-prompt run — profile or exact model selectable under the service.',
    time: 'a one-prompt run: seconds to minutes depending on the model; a desktop session: as long as you keep it open',
    karma: 2,
  },
  provider: {
    name: 'hermes-agent',
    repo: 'https://github.com/nousresearch/hermes-agent',
    launch: 'hermes-agent.exe {{mode}}',
    probe: 'hermes-agent.exe --version',
    update: 'replace the exe with the newest release — the config and sessions carry over',
  },
  variables: {
    init: [
      { name: 'exePath', label: 'hermes-agent.exe', type: 'text', default: 'C:/services/hermes/hermes-agent.exe', help: 'Where the exe lives. Already installed somewhere? Just say where — pointing at an existing install is fine.' },
    ],
    input: [
      { name: 'prompt', label: 'Prompt (one-prompt runs)', type: 'textarea', help: 'Used by the one-prompt mode; ignored by the desktop session.', full: true },
      { name: 'profile', label: 'Profile', type: 'text', default: 'default', muted: true, help: 'Which Hermes profile the run uses.' },
      { name: 'model', label: 'Model override', type: 'text', help: 'Pin an exact model for this run; empty = the profile\'s own choice.', muted: true },
      { name: 'mode', label: 'Run kind', type: 'select', options: ['yolo desktop', 'one prompt'], default: 'one prompt' },
    ],
    files: [],
  },
  modes: [
    {
      name: 'one-prompt',
      fits: { note: 'any machine — one prompt in, the answer out' },
      karma: 2,
      install: {
        steps: [
          'Fetch hermes-agent.exe from the releases page (or point the init variable at an existing install).',
          'That is the whole install — the exe is the provider.',
        ],
        fallback: ['already installed on the main node — ask for its path'],
      },
    },
    {
      name: 'yolo-desktop',
      fits: { note: 'the machine must be one you can watch — the session appears on ITS desktop' },
      karma: 3,
      install: {
        steps: ['Same exe.', 'Runs are VISIBLE: the desktop session opens on the machine\'s own screen. Nothing hidden.'],
      },
    },
  ],
  needs: { gpu: false, ramMb: 2000, cores: 2, diskGb: 1 },
  output: { kind: 'text | session', location: 'stdout for one-prompt runs; the machine\'s own desktop for yolo sessions', description: 'the run\'s answer, or a live desktop session — visible by definition' },
  update: { command: 'swap in the newest release exe', note: 'WHEN to update is the user\'s and Echidna\'s call — the how is declared right here.' },
  pages: {
    ad: `<style>
  .svc { font: 14px/1.6 system-ui, sans-serif; color: #d8dee9; background: #10141a; padding: 20px; max-width: 760px; }
  .svc h1 { font-size: 20px; margin: 0 0 2px; } .svc h2 { font-size: 15px; margin: 20px 0 6px; color: #9ecbff; }
  .svc .dim { color: #7b8794; } .svc pre { background: #1b232e; padding: 10px 12px; border-radius: 6px; overflow-x: auto; font: 12px/1.5 Consolas, monospace; white-space: pre-wrap; }
  .svc .k { background: #3b4a5c; padding: 1px 7px; border-radius: 10px; font-size: 12px; }
  </style>
  <div class="svc">
  <h1>Agent Runs — hermes-agent</h1>
  <p class="dim">starter service · ships with Hydra by default · the provider is the agent itself</p>
  <p>Two kinds of run: a <b>yolo desktop</b> session (opens on the machine — visible by definition), or a <b>one prompt</b> run (in, answer, out). A profile or an exact model can be pinned under the service. <b>Karma weight:</b> <span class="k">2</span> / <span class="k">3</span> (relative; free at zero — its effect is queue priority, paid to the provider after use).</p>
  <h2>Install — the provider app (hermes-agent.exe)</h2>
  <pre>Fetch the exe from the releases page: https://github.com/nousresearch/hermes-agent/releases
Drop it anywhere the service's exePath variable points — C:/services/hermes/ by default.
Already installed? Say where it is; pointing at an existing install is fine.</pre>
  <h2>Install — the service</h2>
  <pre>Nothing to download: the exe is the whole provider. The profile and model inputs shape the run.</pre>
  <h2>Update</h2>
  <pre>Swap in the newest release exe. Config and sessions carry over.</pre>
  <h2>Honesty notes</h2>
  <p><b>Visible:</b> a desktop session appears on the machine's own screen — no hidden processes. <b>Verdicts:</b> a one-prompt run's stdout is its evidence; keep it.</p>
  </div>`,
    inputs: `<style>
  .svc { font: 14px/1.6 system-ui, sans-serif; color: #d8dee9; background: #10141a; padding: 20px; max-width: 760px; }
  .svc h1 { font-size: 20px; margin: 0 0 2px; } .svc pre { background: #1b232e; padding: 10px 12px; border-radius: 6px; overflow-x: auto; font: 12px/1.5 Consolas, monospace; white-space: pre-wrap; }
  .svc .dim { color: #7b8794; }
  </style>
  <div class="svc">
  <h1>The way in</h1>
  <p>Gathered here before the run. A one-prompt run answers at the end; a desktop session appears on the machine itself — <b>visible by definition</b>.</p>
  <pre>hermes-agent.exe --yolo desktop            (a session on this machine's own screen)
hermes-agent.exe -p "your prompt"          (one-prompt run: the answer comes back)</pre>
  <p>Inputs: <b>prompt</b> · <b>profile</b> · <b>model</b> · <b>mode</b> (which kind of run).</p>
  </div>`,
  },
  progress: { how: 'a one-prompt run answers at the end; a desktop session is visible on the machine itself', source: 'none' },
};
