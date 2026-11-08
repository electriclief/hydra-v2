// idle-mining — what this node does when the fleet has nothing for it.
//
// This is a SERVICE in the catalog so that the rest of Hydra can see it, count it, and reason about it: the Menu lists
// it, the Mirror reports it, and a person reading a node's card can tell "this machine is working on something" from
// "this machine is idle and therefore mining". It is not a job and it must never be booked by the Scheduler: starting it
// on purpose while a render is running is exactly the contest the guard exists to prevent.
//
// The line between the two layers is deliberate:
//   * this file  = what the service IS (provider, needs, the knobs and their defaults) — identical on every node
//   * node.json  = how THIS box does it (command, cwd, pool, label, after) — instance layer, never in here
// That is why there is no provider.launch below: the launch command is instance data, and the guard reads it from
// node.json's standby.start block.
module.exports = {
  name: 'idle-mining',
  version: '0.1.0',
  schema: 2,
  kind: 'idle',            // the catalog's marker: this is the fallback state, not a dispatchable task
  dispatch: false,         // the Scheduler must never book it; the guard owns when it runs
  task: 'idle',
  tasks: ['idle'],

  advert: {
    what: 'The card mines while nothing else wants it, and stops the moment real work arrives. Not a job you can submit — this is what the node does with an idle GPU.',
    time: 'continuously while idle; a share lands every one to ten minutes at RX 590 speed',
    karma: 0,   // free: it never outranks real work, it only fills the gaps
  },

  provider: {
    name: 'SRBMiner-MULTI',
    build: 'via unMiner (unMineable wrapper)',
    backend: 'OpenCL',
    repo: 'https://github.com/doktor83/SRBMiner-Multi',
    note: 'Launched through ProcessWrapper with --disable-cpu so the CPU is never billed to the pool. On robert the launcher is unMiner.exe from node.json standby.start; on 123 it is SRBMiner-MULTI directly. Same service, different instance data.',
    update: 'replace the binary; the guard re-reads node.json standby.start on its next poll',
  },

  // No weights. The "model" is the algorithm, and that belongs to the pool, not to this machine.
  models: [],

  needs: { gpu: true, ramMb: 2048, cores: 1, diskGb: 1 },
  whenItDoesNotFit: 'A card that cannot run the current algorithm simply does not mine; that is not an error and it is not a reason to block real work. Nothing else on the node depends on this service existing.',

  variables: {
    init: [
      { name: 'after', label: 'Resume after', type: 'number', default: 1800, help: 'Seconds of quiet before mining resumes. 1800 = 30 minutes, the operator rule: a render that pauses between stages must not lose the card to a miner mid-job. The Scheduler book may lengthen this; the guard floors it at the value declared in node.json.' },
      { name: 'poll', label: 'Watch interval', type: 'number', default: 15, muted: true, help: 'How often the guard looks for AI work on the card. 15 s yields the GPU within one poll, which is the measured number that kept a 59 s/it render alive.' },
      { name: 'apiPort', label: 'Miner API port', type: 'number', default: 60130, muted: true, help: 'Where SRBMiner answers its own JSON. The share wall reads it here: rate, accepted, rejected, pool.' },
      { name: 'gpuOnly', label: 'GPU only', type: 'boolean', default: true, help: 'CPU mining is off by design on every node: the CPU is needed to feed the card, and the pool pays nothing for it.' },
    ],
  },

  modes: [
    {
      name: 'gpu-only',
      what: 'One algorithm on the GPU, CPU disabled, API on localhost for the share wall.',
      install: { steps: ['the provider binary is on disk and node.json standby.start points at it', 'ProcessWrapper raises it as a supervised row so it stays visible with a close button'] },
    },
    {
      name: 'cpu-randomx',
      what: 'xmrig on the CPU while the GPU mines — two miners, two resources, no contention. Off by default; on purpose (see honest).',
      parallel: true,   // the point of this mode: it runs ALONGSIDE the GPU miner instead of instead of it
      install: {
        steps: [
          'xmrig on disk, launched as its own ProcessWrapper row with its own API port (- -http-port), never as a service.',
          'CPU affinity pinned away from the cores that feed the card where the driver needs them.',
          'The share wall reads a second API then: one panel per miner, or the same panel with the CPU lines labelled.',
        ],
      },
      honest: 'RandomX pays in fractions of a cent and bills in watts — the same arithmetic that made the GPU break-even 2,280 MH/s applies here, only more so. It is worth running because it is free heat, a health signal, and a use for cores that a pure-GPU node leaves asleep — not because it earns. Measured hashrate is NOT recorded here yet: do not quote a number until one is taken on the node that runs it.',
    },
  ],

  // Two pages, one service: the sell sheet (why anyone wants it) and the way in (the knobs, with what they mean).
  pages: {
    ad: `<h1>Idle mining</h1>
<p class="lede">When the fleet has nothing for this machine, the card still works. When something arrives, it stops.</p>
<h2>What it is</h2>
<p>A gap-filler, not a workload. The node mines a pool algorithm while it is idle, and the standby guard takes the card
away the moment real work appears &mdash; a render, an LLM, a transcription. Nothing queues behind it and nothing waits
for it.</p>
<h2>Why it exists</h2>
<p>An idle GPU earns nothing. This one earns a little, and more usefully it is a signal: if the shares are landing, the
card, the driver, the wrapper and the network are all alive. A wall of accepted shares is a health check you can read
from across the room.</p>
<h2>What it will never do</h2>
<p>Outrank real work. It is deliberately not dispatchable: the Scheduler cannot book it, and starting it by hand while
a render is running is the exact contest the guard exists to prevent.</p>`,
    inputs: `<h1>Idle mining &mdash; how it is set up</h1>
<p class="lede">All of these live in the instance layer (<code>module/Menu/data/node.json</code> &rarr; <code>standby</code>),
so the same service runs on every node without editing this file.</p>
<table>
<tr><th>setting</th><th>default</th><th>means</th></tr>
<tr><td><code>after</code></td><td>1800 s</td><td>Quiet time before mining resumes. 30 minutes, the operator rule: a render that pauses between stages must not lose the card to a miner mid-job. The Scheduler book can lengthen it; the guard floors it here.</td></tr>
<tr><td><code>poll</code></td><td>15 s</td><td>How often the guard looks for AI work. Yields the card within one poll.</td></tr>
<tr><td><code>apiPort</code></td><td>60130</td><td>Where the miner answers its own JSON. The share wall reads rate, accepted, rejected and pool from here.</td></tr>
<tr><td><code>gpuOnly</code></td><td>true</td><td>CPU mining is off by default: the CPU is needed to feed the card and the pool pays nothing for it. The <code>cpu-randomx</code> mode exists for the opposite choice &mdash; xmrig alongside the GPU miner, two resources, no contention.</td></tr>
<tr><td><code>label</code></td><td>per node</td><td>What this node actually mines, e.g. <code>quantus mining</code>. Shown on the state card and on the share wall.</td></tr>
</table>
<h2>Where to watch it</h2>
<p>The wall on the node's own screen (<code>scripts/miner-wall.ps1</code>) prints every accepted share with the rate at
that moment, plus <strong>YIELD</strong> and <strong>RESUME</strong> lines when the guard hands the card over and takes it
back. The same numbers are on the fleet page and in <code>data/standby/guard.log</code>.</p>`,
  },
};
