// agent-brain — where the CHOICE of brain is made, so nobody has to edit a YAML to change their mind.
//
// The agent (Echidna) is one thing on this LAN. What answers it is four different things, and they are not
// interchangeable: a GGUF on this card is free and private and slow to start; a GGUF on another node is nearly free and
// private and crosses the LAN; a free OpenRouter model is neither private nor yours but it is instant and enormous; a
// direct DeepSeek key is cheap and fast and third-party.
//
// This service declares all four as BACK ENDS of one service, because that is what they are: the same question, asked
// of a different machine. Which one is in use is INSTANCE data (data/brain.json next to this catalog), not a property
// of the service — the same rule as idle-mining: the file says what a back end IS, the node says which one it uses.
//
// Hydra is where the choice is entered. `scripts/set-brain.ps1 -Backend <id>` reads this declaration, writes the
// Hermes config that implements it, restarts the Echidna door and then asks the agent one question to prove the
// choice took. No key is ever invented here: a back end that needs one says which variable it wants and refuses
// until the operator puts it in .env.
module.exports = {
  name: 'agent-brain',
  version: '0.1.0',
  schema: 2,
  dispatch: false,          // the Scheduler must not book "make the agent smarter" as a job
  task: 'agent-inference',
  tasks: ['agent-inference', 'text-generation'],

  advert: {
    what: 'The four brains the agent can be pointed at — a GGUF on this GPU, a GGUF on another node, a free OpenRouter model, or a direct DeepSeek key. One service, one place to choose, and a probe that proves the choice before anyone trusts it.',
    time: 'switching takes seconds; the first answer after a switch pays the model load',
    karma: 9,
  },

  provider: {
    name: 'Hermes provider layer',
    build: 'hermes chat --query-file … --oneshot -Q --format stream-json',
    backend: 'OpenAI-compatible',
    note: 'Every back end below is reached through the same Hermes switch: model.provider + model.base_url + model.default in config.yaml. A local or LAN llama.cpp is provider "custom" with its /v1 URL; OpenRouter and DeepSeek are their own providers with their own keys. Nothing about the agent changes when the brain does.',
    update: 'a new back end is a new entry in `backends` here, plus the config it needs — not a new service',
  },

  // Declaration only: no weights travel with this service. Each back end names its own model id.
  models: [],

  needs: { gpu: false, ramMb: 256, cores: 1, diskGb: 0 },
  whenItDoesNotFit: 'A back end that cannot be reached does not break the agent — the probe refuses with the reason (no key, no server on that port, no such model) and the previous brain stays in place until a new one proves itself.',

  // ---------------------------------------------------------------------------------------------------------------
  // THE FOUR. `id` is what set-brain.ps1 takes; `apply` is exactly what goes into the Hermes config.
  // ---------------------------------------------------------------------------------------------------------------
  backends: [
    {
      id: 'llama-local',
      label: 'llama.cpp on this node',
      where: 'this machine, port 8080',
      what: 'A GGUF on this GPU. Nothing leaves the room, nothing is metered, and the model is whatever the card can hold.',
      apply: { provider: 'custom', base_url: 'http://127.0.0.1:8080/v1', model_from: 'llama-chat' },
      keyEnv: null,
      cost: 'electricity',
      privacy: 'nothing leaves the machine',
      latency: 'first token after the load (seconds to a minute), then line rate',
      needs: { gpu: true, vramGb: 8, ramMb: 4096 },
      prove: 'GET /health on the port, then one one-shot ask',
      honest: 'The model must match the card: a 9B at Q8 is 9.1 GiB and will not fit an 8 GB Polaris, so robert takes a 4-bit or a smaller family. That is a fact about weights, not a setting.',
    },
    {
      id: 'llama-lan',
      label: 'llama.cpp on another node',
      where: 'another node on the LAN, port 8080',
      what: 'The same llama.cpp, on a card that is idle somewhere else in the house. Nearly free, still private, and it crosses only the LAN.',
      apply: { provider: 'custom', base_url: 'http://{{host}}:8080/v1', model_from: 'that node\'s llama-chat' },
      keyEnv: null,
      cost: 'electricity on that node',
      privacy: 'nothing leaves the LAN',
      latency: 'line rate plus LAN round-trip (sub-millisecond at home)',
      needs: { gpu: true, vramGb: 8 },
      prove: 'GET http://{{host}}:8080/health, then one one-shot ask',
      honest: 'A node that is asleep, mining hard, or mid-render will answer wrongly or not at all — the probe says which. Mining is fine: llama.cpp and the miner both want the card, so the standby guard is what decides who gets it.',
    },
    {
      id: 'openrouter-free',
      label: 'OpenRouter — best free model',
      where: 'openrouter.ai',
      what: 'A free tier model with a million-token context and tool calling, which is what a coding agent actually needs. No card, no load, no waiting.',
      apply: { provider: 'openrouter', model: 'nvidia/nemotron-3.5-super-vl:free', base_url: 'https://openrouter.ai/api/v1' },
      keyEnv: 'OPENROUTER_API_KEY',
      cost: 'free tier, rate-limited; paid models on the same key',
      privacy: 'every prompt leaves the house and is processed by a third party',
      latency: 'network plus queue — usually under a second to first token',
      needs: {},
      prove: 'GET /api/v1/models with the key, then one one-shot ask',
      honest: 'Free means rate-limited and occasionally unavailable; a 429 is not a broken config. The 16 free models on 2026-11-08 that advertise tool support are listed in the inputs page, best first.',
    },
    {
      id: 'deepseek',
      label: 'DeepSeek (direct key)',
      where: 'api.deepseek.com',
      what: 'A direct DeepSeek key, the same one this controller already runs on. Cheap, fast, and the most predictable of the three cloud options.',
      apply: { provider: 'deepseek', model: 'deepseek-flash', base_url: 'https://api.deepseek.com/v1' },
      keyEnv: 'DEEPSEEK_API_KEY',
      cost: 'per token, paid — cents, not dollars, for a conversation',
      privacy: 'prompts leave the house',
      latency: 'network — the fastest of the four in practice',
      needs: {},
      prove: 'one one-shot ask',
      honest: 'Another DeepSeek instance is a legitimate fourth brain, not a fallback: it is the same provider as this controller, so behaviour and cost are known rather than hoped for.',
    },
  ],

  variables: {
    init: [
      { name: 'backend', label: 'Which brain', type: 'select', default: 'deepseek', options: ['llama-local', 'llama-lan', 'openrouter-free', 'deepseek'], help: 'The entry point. Written to data/brain.json and applied with scripts/set-brain.ps1 -Backend <id>.' },
      { name: 'lanHost', label: 'LAN node address', type: 'text', default: '', help: 'For llama-lan only: the node that serves llama.cpp, e.g. 192.168.1.140 for the gtx-980ti box once it is up.' },
      { name: 'probe', label: 'Prove it after switching', type: 'boolean', default: true, help: 'Ask one question and refuse to call the switch done unless an answer comes back.' },
    ],
  },

  modes: [
    {
      name: 'switchable',
      what: 'One agent, four brains. The choice is instance data; Hermes is configured to match it; a probe proves it.',
      install: {
        steps: [
          'The agent binary is installed (hermes) and answers --help.',
          'For llama back ends: llama.cpp serving /v1 on the port named here, and /health answering.',
          'For cloud back ends: the key variable named by keyEnv exists in the hermes .env — the script will not invent one.',
          'Run scripts/set-brain.ps1 -Backend <id> -Probe. It backs up config.yaml, writes the four lines, restarts the Echidna door and asks one question.',
        ],
      },
    },
  ],

  output: { kind: 'service', location: 'the agent itself — talk pane, doors, and every job that asks it something', description: 'answers, in the voice of whichever brain is selected' },
  update: { command: 'add an entry to backends, ship, reload services', note: 'The four are a starting set, not a limit.' },

  // WHAT THE BUTTONS RUN. The Services door has one action: POST /api/services/:name/apply, and it only ever runs the
  // script named HERE — a caller can pass a backend, a host and a model, never a command.
  apply: {
    script: 'scripts/set-brain.ps1',
    backendFlag: '-Backend',
    hostFlag: '-Host_',
    modelFlag: '-Model',
    probeFlag: '-Probe',
  },

  pages: {
    ad: `<h1>One agent, four brains</h1>
<p class="lede">Echidna is the same agent whichever brain is behind it. What changes is where the thinking happens — and that
is a choice, not a config file in someone's home directory.</p>
<h2>The four</h2>
<table>
<tr><th>brain</th><th>where</th><th>cost</th><th>privacy</th></tr>
<tr><td><b>llama.cpp, this node</b></td><td>this GPU, port 8080</td><td>electricity</td><td>nothing leaves the machine</td></tr>
<tr><td><b>llama.cpp, another node</b></td><td>a LAN card, port 8080</td><td>electricity there</td><td>nothing leaves the LAN</td></tr>
<tr><td><b>OpenRouter free</b></td><td>openrouter.ai</td><td>free, rate-limited</td><td>prompts leave the house</td></tr>
<tr><td><b>DeepSeek direct</b></td><td>api.deepseek.com</td><td>paid, cents</td><td>prompts leave the house</td></tr>
</table>
<h2>Why it is a service and not a setting</h2>
<p>A brain has requirements, a cost and a failure mode. Declared here, the fleet can answer "which node can serve a 9B at
Q8" or "what is the agent running on right now" without opening a shell. Set inside an agent's own config, none of that
exists and the choice becomes folklore.</p>
<h2>What it will not do</h2>
<p>It will not pretend a switch worked. Every change ends with one question asked of the new brain; if no answer comes
back, the reason is printed and the previous choice stays in force.</p>`,

    inputs: `<h1>Choosing the brain</h1>
<p class="lede">Press one. The door runs the switch script, configures Hermes, restarts the talk door and asks the new brain
one question &mdash; a switch that cannot answer is a switch that did not happen.</p>
<style>
  .pick { display: grid; gap: 8px; margin: 12px 0 4px; }
  .pick button { text-align: left; background: #141b25; color: #d8dee9; border: 1px solid #2a3642; border-radius: 6px;
    padding: 10px 12px; font: inherit; cursor: pointer; }
  .pick button:hover { border-color: #8fb3d9; background: #17202c; }
  .pick b { display: block; font-size: 13.5px; }
  .pick span { color: #8b96a5; font-size: 12.5px; }
  .pick input { background: #0e141b; color: #d8dee9; border: 1px solid #2a3642; border-radius: 6px; padding: 7px 9px;
    font: 13px ui-monospace, Consolas, monospace; margin-top: 6px; width: 220px; }
  #brain-log { background: #0b1016; border: 1px solid #22303c; border-radius: 6px; padding: 10px; margin-top: 12px;
    font: 12px/1.5 ui-monospace, Consolas, monospace; color: #b7c4d3; white-space: pre-wrap; max-height: 260px; overflow: auto; }
</style>
<div class="pick">
  <button data-backend="llama-local"><b>llama.cpp on this node</b><span>this GPU, port 8080 &mdash; free, private, the model must fit the card</span></button>
  <button data-backend="llama-lan"><b>llama.cpp on another node</b><span>a LAN card at port 8080 &mdash; free, private, put the address below</span>
    <input id="lan-host" placeholder="192.168.1.140" value="" /></button>
  <button data-backend="openrouter-free"><b>OpenRouter &mdash; best free model</b><span>1M context, tools, instant &mdash; prompts leave the house, needs OPENROUTER_API_KEY</span></button>
  <button data-backend="deepseek"><b>DeepSeek (direct key)</b><span>cheap, fastest, the controller's own provider &mdash; needs DEEPSEEK_API_KEY</span></button>
</div>
<div id="brain-log">nothing switched yet in this session.</div>
<script>
(function () {
  var log = document.getElementById('brain-log');
  function say(line) { log.textContent = line + '\\n\\n' + log.textContent; }
  Array.prototype.forEach.call(document.querySelectorAll('.pick button'), function (btn) {
    btn.addEventListener('click', function () {
      var backend = btn.getAttribute('data-backend');
      var body = { backend: backend, probe: true };
      if (backend === 'llama-lan') {
        var hostInput = document.getElementById('lan-host');
        if (!hostInput.value.trim()) { say('llama-lan needs the address of the node that serves llama.cpp.'); return; }
        body.host = hostInput.value.trim();
      }
      say('switching to ' + backend + ' …');
      fetch('apply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          say((j.ok ? 'SWITCHED · ' : 'REFUSED · ') + backend + '  (' + Math.round((j.ms || 0) / 1000) + 's)\\n' + (j.output || j.error && j.error.message || ''));
        })
        .catch(function (e) { say('could not reach the door: ' + (e && e.message ? e.message : e)); });
    });
  });
})();
</script>
<h2>What each one needs</h2>
<table>
<tr><th>backend</th><th>needs</th><th>fails as</th></tr>
<tr><td><code>llama-local</code></td><td>llama-server on 127.0.0.1:8080, a GGUF the card can hold</td><td>connection refused — nothing is serving</td></tr>
<tr><td><code>llama-lan</code></td><td>that node awake and serving /v1</td><td>timeout, or a 404 if the node's port differs</td></tr>
<tr><td><code>openrouter-free</code></td><td>OPENROUTER_API_KEY in .env</td><td>"no key" — the script says the variable name, it does not invent a value</td></tr>
<tr><td><code>deepseek</code></td><td>DEEPSEEK_API_KEY in .env</td><td>"no key", or 401 if the key is stale</td></tr>
</table>
<h2>Free models on OpenRouter, 2026-11-08</h2>
<p>All of these advertise tool support, which an agent needs — a chat model without tools cannot run a door or read a
file. Best first for agent work:</p>
<table>
<tr><th>model</th><th>context</th><th>why</th></tr>
<tr><td><code>nvidia/nemotron-3.5-super-vl:free</code></td><td>1,048,576</td><td>the pick: huge span, text + image + video, tools</td></tr>
<tr><td><code>nvidia/nemotron-3-ultra-550b-a55b:free</code></td><td>1,048,576</td><td>the heaviest reasoner of the free set</td></tr>
<tr><td><code>nvidia/nemotron-3.5-lightning:free</code></td><td>1,048,576</td><td>fastest of the big-context ones</td></tr>
<tr><td><code>cohere/north-mini-code:free</code></td><td>262,144</td><td>code-shaped, not general chat</td></tr>
<tr><td><code>google/gemma-4-31b-it:free</code></td><td>262,144</td><td>solid generalist, image + video in</td></tr>
</table>
<p class="dim">Free tiers move. Re-read the list with <code>curl -s https://openrouter.ai/api/v1/models</code> and filter
<code>pricing.prompt == 0</code> — this table is a measurement with a date on it, not a promise.</p>`,
  },
};
