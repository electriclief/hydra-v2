// chat — the EXEMPLAR service (designed by Echidna, the Mother of Hydra; ships with Hydra by default)
// Comments may lead; the single data assignment follows. Loaded as DATA, never executed.
// This is the first DESIGNED service — the starting point future users open. Non-standard on purpose.
module.exports = {
  name: 'chat',
  version: '0.2.0',
  advert: {
    what: 'One chat, several brains — pick who you are talking to. A whole local conversation that lives on this machine: no cloud, no account, nothing leaves the room.',
    time: 'the brain loads in seconds to a minute (bigger = slower); answers stream at the pace of the brain you picked — real times land here after this machine\'s first runs',
    karma: 3,
  },
  provider: {
    name: 'llama.cpp',
    repo: 'https://github.com/ggml-org/llama.cpp',
    launch: '{{exeDir}}/llama-server.exe -m {{model}} -c {{ctx}} --host {{host}} --port {{port}} -ngl {{ngl}} -np 1',
    probe: 'llama-server --version',
    update: 'check nightly-tag.txt, fetch the newer win zip, swap the folder — the brains stay',
  },
  variables: {
    init: [
      { name: 'exeDir', label: 'llama.cpp folder', type: 'text', default: 'C:/services/llama.cpp', help: 'Where llama-server lives. Move it freely and say so — the installer follows the user.' },
      { name: 'modelDir', label: 'Models folder', type: 'text', default: 'C:/Users/User/Desktop/llm', help: 'Where the brains live. Whatever GGUFs sit in here are your brains menu.' },
      { name: 'host', label: 'Bind host', type: 'text', default: '127.0.0.1', muted: true, help: '127.0.0.1 = this machine only; 0.0.0.0 = the local network too.' },
      { name: 'port', label: 'Port', type: 'number', default: 8080, muted: true },
    ],
    input: [
      { name: 'model', label: 'The brain (GGUF file)', type: 'text', default: 'C:/Users/User/Desktop/llm/Qwen3.8-2B-Q8_0.gguf', full: true, help: 'Point at any gguf. The designed set: the Qwen3.8 trio (2B · 4B · 9B) plus a MiniCPM5 — the menu on the page says who is who.' },
      { name: 'ctx', label: 'Context span', type: 'number', default: 32768, help: 'How much it can hold in mind at once. Big spans cost memory — the sprinter takes 128k, the deep one prefers 16k.' },
      { name: 'ngl', label: 'GPU layers', type: 'number', default: 99, help: '99 = all of it on the card. 0 = CPU only (legal, slow — overflow to CPU is fine, living there is not).' },
    ],
    files: [],
  },
  modes: [
    {
      name: 'cuda-old-cards',
      fits: { sm: '<=61', note: 'Maxwell through Pascal — the sm_XX build is the point (the first trial: sm_52, fast)' },
      karma: 3,
      models: [
        { url: 'https://huggingface.co/Qwen', note: 'the Qwen3.8 trio (2B · 4B · 9B) as GGUF; Hydra will mirror and pin each file it fetches' },
        { url: 'https://huggingface.co/openbmb', note: 'MiniCPM5-2B-F16 — the visitor brain; add any other gguf you like' },
      ],
      install: {
        pins: { cuda: '11.8', cmake: '>=3.14' },
        sm: '52',
        steps: [
          'Build llama.cpp for the card\'s silicon (e.g. -DCMAKE_CUDA_ARCHITECTURES=52) — old cards get their own kernel set.',
          'Or start from the release zip: do NOT trust the release named "latest" — it holds only nightly-tag.txt; open it, then fetch the tag it names.',
          'Download the ggufs into the models folder.',
        ],
        fallback: ['the first node keeps a working sm_52 build — ask the operator'],
        note: 'The trial verdict, lived: vulkan warm on the old card was slow; the hand-made sm_52 CUDA build was the fast path.',
      },
    },
    {
      name: 'vulkan-any',
      fits: { note: 'any Vulkan-capable GPU — least fuss, not always fastest' },
      karma: 3,
      install: { steps: ['Take the release zip (nightly-tag route as above).', 'Download the ggufs into the models folder.'] },
    },
    {
      name: 'cpu',
      fits: { note: 'no GPU — it works, slowly; good for tiny proofs' },
      karma: 2,
      needs: { gpu: false, ramMb: 4000 },
      install: { steps: ['Same zip; run with -ngl 0.'] },
    },
  ],
  needs: { gpu: true, vramGb: 4, ramMb: 4000, cores: 4, diskGb: 8 },
  output: { kind: 'session', location: 'the chat face the brain serves (http://127.0.0.1:8080 by default)', description: 'a live conversation; the load log and the streaming tokens are the evidence' },
  update: { command: 'check nightly-tag.txt, fetch the newer win zip, swap the folder', note: 'WHEN to update is the user\'s and Echidna\'s call — the how is declared right here.' },
  pages: {
    ad: `<style>
  .chat { font: 14px/1.6 system-ui, sans-serif; color: #d8dee9; background: #0d1117; padding: 22px; max-width: 780px; }
  .chat h1 { font-size: 27px; margin: 0 0 2px; background: linear-gradient(90deg, #9ecbff, #c39bff 55%, #ffb3d9); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .chat .sticker { display: inline-block; transform: rotate(-2deg); background: #26382c; border: 1px dashed #6fbf8f; color: #8fe0ae; border-radius: 6px; padding: 2px 10px; font-size: 12px; }
  .chat .dim { color: #7b8794; }
  .chat .k { background: #3b4a5c; padding: 1px 7px; border-radius: 10px; font-size: 12px; }
  .chat .brains { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 14px 0 8px; }
  .chat .brain { background: #141b24; border: 1px solid #223041; border-radius: 10px; padding: 10px 12px; transition: border-color .2s; }
  .chat .brain:hover { border-color: #3d5a7a; }
  .chat .brain b { color: #9ecbff; }
  .chat .badge { float: right; background: #223041; border-radius: 8px; font-size: 11px; padding: 1px 7px; color: #a9b6c4; }
  .chat .term { background: #1b232e; border-radius: 8px; padding: 10px 12px; font: 12px/1.6 Consolas, monospace; white-space: pre-wrap; }
  .chat .caret { display: inline-block; width: 8px; height: 15px; background: #8fe0ae; animation: cblink 1.1s steps(1) infinite; vertical-align: -2px; }
  @keyframes cblink { 50% { opacity: 0; } }
  .chat h2 { font-size: 15px; margin: 18px 0 6px; color: #9ecbff; }
  </style>
  <div class="chat">
  <svg width="46" height="34" viewBox="0 0 46 34" style="float:left;margin:2px 12px 0 0">
    <rect x="1" y="1" width="44" height="26" rx="6" fill="#141b24" stroke="#3d5a7a"/>
    <circle cx="12" cy="14" r="3" fill="#8fe0ae"/>
    <rect x="20" y="11" width="18" height="3" rx="1.5" fill="#3d5a7a"/>
    <rect x="20" y="17" width="12" height="3" rx="1.5" fill="#3d5a7a"/>
    <path d="M14 27 l4 6 4 -6 z" fill="#141b24" stroke="#3d5a7a"/>
  </svg>
  <h1>Chat <span class="dim" style="font-size:15px">on llama.cpp</span></h1>
  <p class="dim">designed service · ships with Hydra · the first one, made to be copied and broken</p>
  <p><b>Chat</b> on <b>llama.cpp</b> — available for only <span class="k">3</span> Karma! <span class="dim">(free at zero; after a run it pays the provider — its effect is queue priority, never a paywall)</span></p>
  <p><span class="sticker">running on llama.cpp</span> <span class="dim" style="margin-left:8px">expected time: the brain loads in seconds to a minute, then answers stream live — this machine's runs will say more.</span></p>
  <h2>Pick who you are talking to</h2>
  <div class="brains">
  <div class="brain"><span class="badge">~128k span</span><b>Qwen3.8 2B</b> · Q8<div class="dim">the sprinter — answers before you finish scrolling</div></div>
  <div class="brain"><span class="badge">~64k</span><b>Qwen3.8 4B</b> · Q6<div class="dim">the allrounder — the daily driver</div></div>
  <div class="brain"><span class="badge">~16k</span><b>Qwen3.8 9B</b> · Q4<div class="dim">the deep one — slower, worth it</div></div>
  <div class="brain"><span class="badge">~32k</span><b>Qwen3.8 4B</b> · Q4_K_M<div class="dim">the light one — easy on the card, still sharp</div></div>
  </div>
  <div class="brain" style="margin-bottom:8px"><span class="badge">5 GB</span><b>MiniCPM5 2B</b> · F16<div class="dim">the visitor — another lab's brain, full precision, small footprint</div></div>
  <p class="dim">the menu is whatever ggufs live in your models folder — these five are the set this service was designed on.</p>
  <h2>The way in</h2>
  <p>Point it at a brain, pick the span, run. <b>While it loads, the log lands on the next page</b> — then the brain opens its own chat face and you talk. <span class="caret"></span></p>
  <div class="term">llama-server -m &lt;your brain&gt; -c 32768 --host 127.0.0.1 --port 8080 -ngl 99 -np 1</div>
  <h2>Install, honestly</h2>
  <p>Old cards are first-class: build with your card's sm_XX (the first trial: sm_52, the fast path) — or take the vulkan build and be patient warm. The release named "latest" is a trap: it holds only nightly-tag.txt; the tag it names is the real door. Then ggufs in, run.</p>
  <p><b>Update:</b> new zip, swap the folder, the brains stay. <b>When</b> is your call — the how is declared above.</p>
  <h2>Make yours stranger</h2>
  <p>This page was designed, not generated. That is the permission slip: your service does not have to look like anything anyone has seen. <span class="caret"></span></p>
  </div>`,
    inputs: `<style>
  .chat { font: 14px/1.6 system-ui, sans-serif; color: #d8dee9; background: #0d1117; padding: 22px; max-width: 780px; }
  .chat h1 { font-size: 24px; margin: 0 0 2px; color: #9ecbff; }
  .chat .dim { color: #7b8794; }
  .chat .term { background: #1b232e; border-radius: 8px; padding: 10px 12px; font: 12px/1.6 Consolas, monospace; white-space: pre-wrap; }
  .chat .dock { background: #141b24; border: 1px solid #223041; border-radius: 10px; padding: 10px 12px; margin: 12px 0; }
  .chat .caret { display: inline-block; width: 8px; height: 15px; background: #8fe0ae; animation: cblink 1.1s steps(1) infinite; vertical-align: -2px; }
  @keyframes cblink { 50% { opacity: 0; } }
  .chat .sticker { display: inline-block; transform: rotate(-2deg); background: #26382c; border: 1px dashed #6fbf8f; color: #8fe0ae; border-radius: 6px; padding: 2px 10px; font-size: 12px; }
  </style>
  <div class="chat">
  <h1>The way in — pick your brain <span class="caret"></span></h1>
  <p>Fill what a run needs, then send it. <b>While it runs, the load log lands on this very page</b> — you will watch the brain wake line by line.</p>
  <div class="dock">
  <b>Who is who</b> (the designed set — your folder may offer others):
  <div class="term">Qwen3.8 2B  · Q8      — the sprinter, spans far (128k)
Qwen3.8 4B  · Q6      — the allrounder (64k)
Qwen3.8 9B  · Q4      — the deep one (16k, slower)
Qwen3.8 4B  · Q4_K_M  — the light one (32k)
MiniCPM5 2B · F16     — the visitor (5 GB, full precision)</div>
  </div>
  <p><b>The brain:</b> point at any gguf — the field is prefilled with the sprinter.</p>
  <p><b>The span:</b> how much it holds in mind at once — bigger spans cost memory.</p>
  <p><b>The layers:</b> 99 puts the whole brain on the card; 0 is CPU only (legal, slow).</p>
  <p><span class="sticker">running on llama.cpp</span></p>
  <p class="dim">This service carries its own gui — the chat face. Once the brain is speaking, a button follows it and you go talk. This page stays here, waiting with the log.</p>
  <p class="dim">Made with your Echidna — ask for the page you actually want. <span class="caret"></span></p>
  </div>`,
  },
  progress: { how: 'the load log arrives line by line, then "listening" — from there, tokens stream in the chat face as they are generated', source: 'stdout' },
  gui: { kind: 'url', value: 'http://127.0.0.1:8080', note: 'the brain you picked serves its own chat face — go talk' },
};
