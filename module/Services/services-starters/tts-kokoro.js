// tts-kokoro — text to speech, CPU/ONNX. The first SPEECH service on the shelf.
// Authored 2026-10-19 from a real install on the GTX-1660 node (192.168.1.149): every number
// below is measured there, not guessed. Comments may lead; the single data assignment follows.
// Loaded as DATA, never executed.
module.exports = {
  name: 'tts-kokoro',
  version: '0.1.0',
  advert: {
    what: 'Text becomes a voice file. Kokoro is an 82M-parameter model that speaks English (and more) better than models twenty times its size, and it runs on the CPU — so a node can serve speech WITHOUT giving up its graphics card to mining or rendering.',
    time: 'measured on .149 (GTX-1660 node, CPU): 5.25 s of audio in 13.0 s wall on the first job, 5.87 s of audio in 8.3 s wall warm. Roughly 0.7x realtime, one job at a time, no GPU used.',
    karma: 2,
  },
  provider: {
    name: 'kokoro-onnx',
    repo: 'https://github.com/thewh1teagle/kokoro-onnx',
    launch: '{{root}}/venv/Scripts/python.exe -u {{root}}/tts_server.py',
    probe: 'curl -s http://127.0.0.1:{{port}}/health',
    update: 'swap kokoro-v1.0.onnx for a newer release file from the model-files tag; the server and voices file stay',
  },
  variables: {
    init: [
      { name: 'root', label: 'Install folder', type: 'text', default: 'C:/AI/tts', help: 'Owns its venv, its models and its out folder — nothing shared with ComfyUI or another kit.' },
      { name: 'port', label: 'Port', type: 'number', default: 8100 },
      { name: 'host', label: 'Bind host', type: 'text', default: '0.0.0.0', muted: true, help: '0.0.0.0 = the LAN can call it. A firewall rule is required once per node.' },
    ],
    input: [
      { name: 'text', label: 'Text', type: 'textarea', required: true, full: true, help: 'Free text travels in the request body — never on a command line, so quotes and line breaks are safe.' },
      {
        name: 'voice', label: 'Voice', type: 'select', default: 'af_sarah',
        options: ['af_sarah', 'af_nicole', 'af_heart', 'am_michael', 'am_fenrir', 'am_puck', 'bf_emma', 'bf_isabella', 'bm_george', 'bm_lewis'],
        help: '10 of 54 — the live list is GET /voices on the door.',
      },
      { name: 'speed', label: 'Speed', type: 'number', default: 1.0, help: '1.0 is natural. 0.9 drags, 1.15 hurries.' },
      { name: 'lang', label: 'Language', type: 'select', default: 'en-us', options: ['en-us', 'en-gb', 'fr-fr', 'it-it', 'es-es'] },
    ],
    files: [],
  },
  modes: [
    {
      name: 'cpu-onnx',
      fits: { note: 'PROVEN on .149 — no GPU at all; the miner kept the card the whole time' },
      karma: 2,
      models: [
        { url: 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx', note: '310 MB, the model' },
        { url: 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin', note: '27 MB, 54 voices' },
      ],
      install: {
        pins: { python: '3.10 or newer, a REAL install (not ComfyUI\'s embedded python — it has no venv module)', pip: 'kokoro-onnx 0.6.1 · onnxruntime 1.23.2 · soundfile 0.14.0' },
        steps: [
          'Find a real python: py -0p lists them. The embedded python inside ComfyUI cannot create a venv — that failure cost a round trip.',
          'python -m venv C:\\AI\\tts\\venv  (own folder, own runtime — the kit stays portable)',
          'venv\\Scripts\\python.exe -m pip install kokoro-onnx soundfile',
          'Download the two model files with curl -L -C - (resumable; 337 MB total, ~100 s on this LAN)',
          'Drop tts_server.py and run_tts.cmd into C:\\AI\\tts',
          'Firewall once per node: New-NetFirewallRule -DisplayName "Hydra TTS 8100" -Direction Inbound -Protocol TCP -LocalPort 8100 -Action Allow',
          'Task: schtasks /create /tn Hydra-TTS /tr "C:\\AI\\tts\\run_tts.cmd" /sc once /st 00:00 /it /f ; schtasks /run /tn Hydra-TTS',
        ],
        fallback: [
          'No real Python and no admin? onnxruntime also runs from a zip-extracted embeddable build + get-pip.py, but the venv route is cleaner.',
        ],
        note: 'Model load is ~10-20 s at boot and is paid once; requests never pay it.',
      },
    },
    {
      name: 'gpu-directml',
      fits: { note: 'UNPROVEN — onnxruntime-directml on a 4-8 GB card. Expect faster wall time; do not claim it until measured.' },
      karma: 2,
      models: [
        { url: 'https://pypi.org/project/onnxruntime-directml/', note: 'the same model file; only the runtime changes' },
      ],
      install: { steps: ['pip install onnxruntime-directml in the venv (replaces the CPU runtime)'], fallback: [], note: 'Left unproven on purpose: the CPU path already works and the card belongs to the miner.' },
    },
  ],
  needs: { gpu: false, ramMb: 1500, cores: 2, diskGb: 1 },
  output: {
    kind: 'file',
    location: 'C:/AI/tts/out — one 24 kHz mono 16-bit WAV per run',
    description: 'every job writes tts_<stamp>_<voice>.wav; the same file is served at GET /outputs/<name> so another node can pull it',
  },
  update: { command: 'swap the .onnx for a newer model-files release; keep voices-v1.0.bin unless the release says otherwise', note: 'WHEN to update is the operator\'s call — the how is declared here.' },
  progress: {
    how: 'one line per job on stdout: char count · voice · audio seconds · wall seconds · filename',
    source: 'stdout',
  },
  pages: {
    ad: `<style>
  .tts { font: 15px/1.65 system-ui, -apple-system, "Segoe UI", sans-serif; color: #ece7dd;
    background: #0a0b0d; padding: 26px 24px; max-width: 780px; }
  .tts .k { font: 600 11px/1 ui-monospace, Consolas, monospace; letter-spacing: .24em;
    text-transform: uppercase; color: #d9a441; margin: 0 0 18px; }
  .tts h1 { font: 400 34px/1.1 Georgia, serif; margin: 0 0 14px; letter-spacing: -.01em; }
  .tts .lede { font-size: 16px; color: #cfc8bb; margin: 0 0 22px; max-width: 62ch; }
  .tts .rule { height: 1px; background: rgba(236,231,221,.14); margin: 22px 0; }
  .tts .specs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; margin: 0 0 22px; }
  .tts .specs div { border-right: 1px solid rgba(236,231,221,.14); padding-right: 12px; }
  .tts .specs div:last-child { border-right: 0; }
  .tts .specs dt { font: 500 9.5px/1 ui-monospace, Consolas, monospace; letter-spacing: .18em;
    text-transform: uppercase; color: #8b857a; margin: 0 0 8px; }
  .tts .specs dd { margin: 0; font: 400 19px/1 ui-monospace, Consolas, monospace; color: #ece7dd; }
  .tts .specs dd small { font-size: 11px; color: #8b857a; }
  .tts h2 { font: 500 10.5px/1 ui-monospace, Consolas, monospace; letter-spacing: .2em;
    text-transform: uppercase; color: #8b857a; margin: 0 0 12px; }
  .tts pre { background: #101216; border: 1px solid rgba(236,231,221,.1); padding: 12px 14px;
    border-radius: 3px; font: 12px/1.55 ui-monospace, Consolas, monospace; color: #cfc8bb;
    overflow-x: auto; white-space: pre-wrap; }
  .tts .foot { font: 400 10px/1 ui-monospace, Consolas, monospace; letter-spacing: .18em;
    text-transform: uppercase; color: #5f5a52; margin-top: 22px; }
</style>
<div class="tts">
  <div class="k">The Spoils · Text to Speech</div>
  <h1>It reads, in a voice that costs nothing.</h1>
  <p class="lede">Kokoro is a 82M model that speaks like something much larger. It runs on the
    processor, which means the card in that machine is still free — this is the service a
    mining node can afford to give you.</p>
  <dl class="specs">
    <div><dt>Params</dt><dd>82<small> M</small></dd></div>
    <div><dt>Voices</dt><dd>54</dd></div>
    <div><dt>Realtime</dt><dd>0.7<small>x</small></dd></div>
    <div><dt>Cost</dt><dd>0</dd></div>
  </dl>
  <h2>The receipt</h2>
  <pre>measured on .149 · CPU only
5.25 s of speech  ->  13.0 s wall   (first job, model already warm)
5.87 s of speech  ->   8.3 s wall   (warm)
24 kHz · mono · 16-bit WAV · one job at a time</pre>
  <h2>The door</h2>
  <pre>POST http://192.168.1.149:8100/tts
{"text":"...","voice":"af_sarah","speed":1.0}
-> {"ok":true,"name":"tts_..._af_sarah.wav","seconds":5.25}
GET  /outputs/&lt;name&gt;   the wav itself
GET  /voices             all 54</pre>
  <p class="lede" style="margin-top:20px">Nothing leaves the machine. No account, no key, no
    per-word price. The same text can be re-read tomorrow for the same nothing.</p>
  <div class="foot">Local · Free · Nothing leaves this machine</div>
</div>`,
    inputs: `<style>
  .ti { font: 15px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; color: #ece7dd;
    background: #0a0b0d; padding: 24px; max-width: 780px; }
  .ti .k { font: 600 11px/1 ui-monospace, Consolas, monospace; letter-spacing: .24em;
    text-transform: uppercase; color: #d9a441; margin: 0 0 16px; }
  .ti h1 { font: 400 28px/1.15 Georgia, serif; margin: 0 0 6px; }
  .ti .sub { color: #8b857a; font-size: 13px; margin: 0 0 22px; }
  .ti label { display: block; font: 500 10px/1 ui-monospace, Consolas, monospace; letter-spacing: .18em;
    text-transform: uppercase; color: #8b857a; margin: 0 0 8px; }
  .ti textarea, .ti input, .ti select { width: 100%; box-sizing: border-box; background: #101216;
    color: #ece7dd; border: 1px solid rgba(236,231,221,.12); border-left: 2px solid transparent;
    padding: 12px 13px; font: 400 14px/1.5 inherit; outline: none; }
  .ti textarea { min-height: 130px; resize: vertical; font-size: 15px; }
  .ti .row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .ti .f { margin: 0 0 18px; }
  .ti .help { font-size: 12px; color: #6f6a61; margin-top: 6px; }
  .ti .stamp { border-top: 1px solid rgba(236,231,221,.12); margin-top: 20px; padding-top: 12px;
    font: 11px/1.7 ui-monospace, Consolas, monospace; color: #8b857a; }
  .ti .btn { background: #d9a441; color: #14100a; border: 0; padding: 14px 26px;
    font: 600 12px/1 ui-monospace, Consolas, monospace; letter-spacing: .16em;
    text-transform: uppercase; margin-top: 6px; cursor: pointer; }
</style>
<div class="ti">
  <div class="k">The Spoils · Text to Speech</div>
  <h1>tts-kokoro</h1>
  <p class="sub">Anything you type comes back as a voice file. One job at a time.</p>

  <div class="f">
    <label for="t">Text</label>
    <textarea id="t" name="text" placeholder="Type what should be spoken."></textarea>
    <div class="help">Free text goes in the body — quotes and line breaks are safe.</div>
  </div>

  <div class="row">
    <div class="f">
      <label for="v">Voice</label>
      <select id="v" name="voice" data-default="af_sarah">
        <option>af_sarah</option><option>af_nicole</option><option>af_heart</option>
        <option>am_michael</option><option>am_fenrir</option><option>am_puck</option>
        <option>bf_emma</option><option>bf_isabella</option><option>bm_george</option>
        <option>bm_lewis</option>
      </select>
    </div>
    <div class="f">
      <label for="s">Speed</label>
      <input id="s" name="speed" type="number" step="0.05" value="1.0" data-default="1.0">
    </div>
    <div class="f">
      <label for="l">Language</label>
      <select id="l" name="lang" data-default="en-us">
        <option>en-us</option><option>en-gb</option><option>fr-fr</option>
        <option>it-it</option><option>es-es</option>
      </select>
    </div>
  </div>

  <button class="btn" type="button">Run tts-kokoro →</button>

  <div class="stamp">
    needs: CPU · ~1.5 GB RAM · 1 GB disk — no graphics card<br>
    lands at: C:/AI/tts/out · 24 kHz mono WAV · served at /outputs/&lt;name&gt;<br>
    door: POST /tts · GET /health · GET /voices
  </div>
</div>`,
  },
};
