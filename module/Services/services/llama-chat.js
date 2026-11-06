// llama-chat — a local brain on this node (llama.cpp, the RX 6800).
// This file is a STARTING STATE, not a rulebook. Read it, use what helps, ignore the rest:
// the operator overrides anything here, and nothing below is a gate.
module.exports = {
  name: 'llama-chat',
  version: '0.2.0',
  task: 'text-generation',
  tasks: ['text-generation', 'image-text-to-text'],

  advert: {
    what: 'A whole conversation that lives on this machine: no cloud, no account, nothing leaves the room. llama.cpp serves whichever GGUF is on disk, with an OpenAI-compatible API and its own web chat.',
    time: 'the 9B loads in about half a minute cold, then answers as fast as the card produces tokens',
    karma: 5,
  },

  // THE SOFTWARE that runs the weights. A newer build is a drop-in; nothing else moves.
  provider: {
    name: 'llama.cpp',
    build: 'b9585',
    backend: 'vulkan',
    repo: 'https://github.com/ggml-org/llama.cpp',
    launch: 'llama-server -m {{model}} --host 127.0.0.1 --port {{port}} -c {{ctx}} -ngl 99',
    probe: 'curl -s http://127.0.0.1:{{port}}/health',
    note: 'On this box llmctl.ps1 wraps the same flags (-action start -model … -port … -ctx …) and attaches the mmproj when a model needs vision. Any equivalent launch is fine — what matters is the port and that /health answers.',
    update: 'drop a newer release beside it and point the launcher at it',
  },

  // THE WEIGHTS, exactly as they sit on disk. Bytes and sha256 are what let "the same
  // service on another node" be checked instead of claimed.
  models: [
    { family: 'Qwen3.8-9B', quant: 'Q8_0', role: 'default', file: 'Qwen3.8-9B-Q8_0.gguf',
      bytes: 9786060096,
      sha256: '79ca5d342a07922f2bbf38c8d892a79a3c8620c65feaf4b1c66b7830ae724db8',
      ctxMax: 262144, vramGb: 11,
      note: 'the default brain — 9.11 GiB of weights, and 32k of context adds about 2 GiB on top.' },

    { family: 'Qwen2.5-VL-7B-Instruct', quant: 'Q5_K_S', file: 'Qwen2.5-VL-7B-Instruct-Q5_K_S.gguf',
      bytes: 5315175296,
      sha256: '38d9fd3ab667ba4ce4d1cf1988bdaeedda7be15f5719f9b91f5007e97da96e48',
      mmproj: { file: 'Qwen2.5-VL-7B-Instruct-mmproj-BF16.gguf', bytes: 1354163040,
                sha256: 'f0edf43c09b69d6e5dd24262f33b356a1e9dd978e7c3299b3e69141fcbb87553' },
      ctxMax: 32768, vramGb: 7,
      note: 'reads images too. The mmproj is its eyes and must travel with it — one without the other is half a model.' },

    { family: 'Bonsai-1.7B', quant: null, file: 'Bonsai-1.7B.gguf',
      bytes: 248302272,
      sha256: '3d7c6c90dd98717a203adb22d5eacd2581850e40aa5327e144b97766cae5f7e3',
      ctxMax: 32768, vramGb: 2,
      note: 'tiny and instant, for plumbing and quick checks.' },
  ],

  // WHAT IT WANTS FROM THE MACHINE — a starting point, not a gate. A bigger card runs it
  // faster, a smaller one should take a smaller model, and neither needs permission.
  needs: { gpu: true, vramGb: 11, ramMb: 8000, cores: 4, diskGb: 10.5 },
  whenItDoesNotFit: 'Three ways through, best first. Stop whatever else holds the card — sd-server is the usual thief, and llama-server and sd-server cannot both have it. Or take the 4-bit: 5.4 GiB, noticeably weaker on code. Or let another node run the same digest at LAN latency. Dropping ctx to 8k buys about 2 GiB back, at the cost of long documents.',

  variables: {
    init: [
      { name: 'port', label: 'Port', type: 'number', default: 8080, muted: true, help: 'The API and web chat answer here.' },
      { name: 'ctx', label: 'Context span', type: 'number', default: 32768, help: 'How much it holds in mind at once. llmctl defaults to 262144, far more than a 16 GB card wants for a 9B. Start at 32k.' },
    ],
    input: [
      { name: 'model', label: 'The brain (GGUF on disk)', type: 'select', default: 'Qwen3.8-9B-Q8_0.gguf', options: ['Qwen3.8-9B-Q8_0.gguf', 'Qwen2.5-VL-7B-Instruct-Q5_K_S.gguf', 'Bonsai-1.7B.gguf'], full: true, help: 'Whatever sits in the models folder — three are there. Sizes: 9.1 GiB · 5.0 (+1.3 eyes) · 0.23. The VL model also reads images.' },
      { name: 'note', label: 'Note', type: 'text', default: 'start the brain', muted: true, full: true, help: 'This service starts the server; the conversation happens in the chat page.' },
    ],
    files: [],
  },

  modes: [
    {
      name: 'gpu-full',
      fits: { vramGbMin: '11', note: 'all layers on the card at 32k — the normal case on a 16 GB node' },
      karma: 5,
      install: {
        steps: [
          'Unpack a llama.cpp release as C:/AI/runtime/llama-bXXXX (this node runs b9585) and point the launcher at it.',
          'Put the GGUFs in the models folder — Desktop\llms on this box.',
          'Start with the flags in provider.launch, then check /health before trusting it.',
        ],
        note: 'Follow this or go your own way; the only things that matter are a matching sha256 and a /health that answers.',
      },
    },
  ],

  output: { kind: 'service', location: '/v1/chat/completions on whichever port it was started on', description: 'text (or text + image) streamed back; nothing is written to disk' },
  update: { command: 'new llama.cpp folder + point the launcher at it', note: 'WHEN is the operator call.' },
  gui: { kind: 'url', value: 'http://127.0.0.1:8080/', note: 'the server own chat page and /v1 API — on another node, that node address' },
  pages: {
    ad: `<style>
  html, body { margin: 0; background: #0d1117; }
  .sv { font: 14px/1.65 system-ui, -apple-system, Segoe UI, sans-serif; color: #d8dee9; background: #0d1117; padding: 18px 24px 30px; max-width: none; }
  .sv h1 { font-size: 21px; font-weight: 600; margin: 16px 0 2px; letter-spacing: -0.01em; }
  .sv h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #8fb3d9; margin: 22px 0 6px; }
  .sv p { margin: 6px 0; } .sv .dim { color: #7d8998; }
  .sv ul { margin: 6px 0 6px 18px; padding: 0; } .sv li { margin: 3px 0; }
  .sv .num { font-variant-numeric: tabular-nums; color: #e6edf3; }
  .sv .k { border: 1px solid #2a323d; border-radius: 3px; padding: 0 6px; font-size: 12px; color: #c9d3df; }
  .sv .rule { height: 1px; background: #1c232c; margin: 18px 0; }
  .sv p, .sv ul { max-width: 720px; }
</style>
<div class="sv">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 38 900 226" width="100%" role="img" aria-label="A brain and a machine in a dark room, passing small symbols back and forth">
    <defs>
      <linearGradient id="brainfill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1a2531"/>
        <stop offset="100%" stop-color="#0e151d"/>
      </linearGradient>
      <radialGradient id="glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#8fb3d9" stop-opacity=".30"/>
        <stop offset="60%" stop-color="#8fb3d9" stop-opacity=".07"/>
        <stop offset="100%" stop-color="#8fb3d9" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="screenglow" cx="50%" cy="0%" r="80%">
        <stop offset="0%" stop-color="#8fb3d9" stop-opacity=".16"/>
        <stop offset="100%" stop-color="#0b1016" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="vign" cx="50%" cy="48%" r="66%">
        <stop offset="0%" stop-color="#0d1117" stop-opacity="0"/>
        <stop offset="64%" stop-color="#0d1117" stop-opacity="0"/>
        <stop offset="100%" stop-color="#0d1117" stop-opacity=".96"/>
      </radialGradient>
      <filter id="bloom" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="7"/>
      </filter>
      <clipPath id="brainclip"><path d="M333.7,148 337.2,152.3 339.6,156.8 340.5,161.4 339.7,165.9 337.8,170.3 335.2,174.4 332.2,178.4 329.1,182.3 325.6,186 321.6,189.4 316.8,192.4 311.3,194.6 305.2,196.2 298.9,197.2 292.8,198 287,198.7 281.5,199.4 276.2,200.1 271,200.7 265.9,201.1 260.9,201.5 256,202.1 251.1,203.1 246,204.8 240.6,206.9 234.7,209.2 228.4,211 222,211.9 215.9,211.4 210.2,209.7 205.2,207 200.8,203.9 196.7,200.7 192.6,197.7 188.3,195 183.8,192.4 179.4,189.7 175,186.9 170.9,183.9 166.8,180.7 162.8,177.3 159,173.7 155.6,169.9 153.2,165.8 152.2,161.3 153,156.7 155.4,152.2 158.9,148 162.8,144.1 166.4,140.5 169.1,137.1 171,133.6 172.4,130.1 173.7,126.6 175.5,123.2 177.8,119.9 180.3,116.7 183,113.5 185.4,110.1 187.7,106.4 190,102.4 192.5,98.2 195.7,94.2 199.6,90.6 204.2,87.5 209.4,84.8 214.9,82.5 220.7,80.6 226.8,79.1 233.2,78.3 239.6,78.6 246,80 252,82.4 257.5,85.5 262.5,88.6 267.3,91.3 272,93.3 277.1,94.4 282.5,95.1 288.2,95.8 293.8,96.9 298.9,98.7 303.5,101.2 307.4,104.2 310.7,107.5 313.6,110.9 316.1,114.5 318.1,118.3 319.5,122.1 320.4,126 321.1,129.8 322,133.5 323.6,137 326.2,140.5 329.7,144.1Z"/></clipPath>
      <clipPath id="frame"><rect x="0" y="0" width="900" height="282"/></clipPath>
    </defs>

    <g clip-path="url(#frame)">
      <rect width="900" height="282" fill="#0d1117"/>

      <!-- a floor, so the two of them share a room -->
      <line x1="60" y1="238" x2="840" y2="238" stroke="#7d97b3" stroke-width="1" opacity=".07"/>
      <ellipse cx="250" cy="240" rx="130" ry="10" fill="#0d1117" opacity=".9"/>
      <ellipse cx="750" cy="240" rx="140" ry="10" fill="#0d1117" opacity=".9"/>

      <!-- THE BRAIN: breathes, and pulses when it has something to say -->
      <g>
        <ellipse cx="246" cy="148" rx="120" ry="96" fill="url(#glow)">
          <animate attributeName="opacity" values=".45;.95;.45" dur="4.5s" repeatCount="indefinite"/>
        </ellipse>
        <circle cx="246" cy="148" r="60" fill="none" stroke="#8fb3d9" stroke-width="1" opacity="0">
          <animate attributeName="r" values="60;104" dur="4.5s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values=".28;0" dur="4.5s" repeatCount="indefinite"/>
        </circle>

        <g>
          <animateTransform attributeName="transform" type="translate" values="0 0; 0 -3; 0 0; 0 2; 0 0" keyTimes="0;.32;.55;.8;1" dur="7.5s" repeatCount="indefinite"/>
          <path d="M333.7,148 337.2,152.3 339.6,156.8 340.5,161.4 339.7,165.9 337.8,170.3 335.2,174.4 332.2,178.4 329.1,182.3 325.6,186 321.6,189.4 316.8,192.4 311.3,194.6 305.2,196.2 298.9,197.2 292.8,198 287,198.7 281.5,199.4 276.2,200.1 271,200.7 265.9,201.1 260.9,201.5 256,202.1 251.1,203.1 246,204.8 240.6,206.9 234.7,209.2 228.4,211 222,211.9 215.9,211.4 210.2,209.7 205.2,207 200.8,203.9 196.7,200.7 192.6,197.7 188.3,195 183.8,192.4 179.4,189.7 175,186.9 170.9,183.9 166.8,180.7 162.8,177.3 159,173.7 155.6,169.9 153.2,165.8 152.2,161.3 153,156.7 155.4,152.2 158.9,148 162.8,144.1 166.4,140.5 169.1,137.1 171,133.6 172.4,130.1 173.7,126.6 175.5,123.2 177.8,119.9 180.3,116.7 183,113.5 185.4,110.1 187.7,106.4 190,102.4 192.5,98.2 195.7,94.2 199.6,90.6 204.2,87.5 209.4,84.8 214.9,82.5 220.7,80.6 226.8,79.1 233.2,78.3 239.6,78.6 246,80 252,82.4 257.5,85.5 262.5,88.6 267.3,91.3 272,93.3 277.1,94.4 282.5,95.1 288.2,95.8 293.8,96.9 298.9,98.7 303.5,101.2 307.4,104.2 310.7,107.5 313.6,110.9 316.1,114.5 318.1,118.3 319.5,122.1 320.4,126 321.1,129.8 322,133.5 323.6,137 326.2,140.5 329.7,144.1Z" fill="url(#brainfill)" stroke="#cfe3ff" stroke-width="1.4" opacity=".95"/>
          <g clip-path="url(#brainclip)" opacity=".55">
            <path d="M 244 96 C 252 120, 238 138, 246 158 S 240 184, 250 200" fill="none" stroke="#8fb3d9" stroke-width="1.1" stroke-linecap="round"/><path d="M 206 118 C 222 104, 232 126, 244 116" fill="none" stroke="#8fb3d9" stroke-width="1.1" stroke-linecap="round"/><path d="M 262 116 C 276 104, 292 122, 306 112" fill="none" stroke="#8fb3d9" stroke-width="1.1" stroke-linecap="round"/><path d="M 198 152 C 214 140, 226 164, 240 152" fill="none" stroke="#8fb3d9" stroke-width="1.1" stroke-linecap="round"/><path d="M 258 150 C 274 138, 288 160, 306 150" fill="none" stroke="#8fb3d9" stroke-width="1.1" stroke-linecap="round"/><path d="M 206 184 C 222 172, 234 196, 248 184" fill="none" stroke="#8fb3d9" stroke-width="1.1" stroke-linecap="round"/><path d="M 262 184 C 276 172, 292 192, 308 180" fill="none" stroke="#8fb3d9" stroke-width="1.1" stroke-linecap="round"/>
          </g>
          <path d="M333.7,148 337.2,152.3 339.6,156.8 340.5,161.4 339.7,165.9 337.8,170.3 335.2,174.4 332.2,178.4 329.1,182.3 325.6,186 321.6,189.4 316.8,192.4 311.3,194.6 305.2,196.2 298.9,197.2 292.8,198 287,198.7 281.5,199.4 276.2,200.1 271,200.7 265.9,201.1 260.9,201.5 256,202.1 251.1,203.1 246,204.8 240.6,206.9 234.7,209.2 228.4,211 222,211.9 215.9,211.4 210.2,209.7 205.2,207 200.8,203.9 196.7,200.7 192.6,197.7 188.3,195 183.8,192.4 179.4,189.7 175,186.9 170.9,183.9 166.8,180.7 162.8,177.3 159,173.7 155.6,169.9 153.2,165.8 152.2,161.3 153,156.7 155.4,152.2 158.9,148 162.8,144.1 166.4,140.5 169.1,137.1 171,133.6 172.4,130.1 173.7,126.6 175.5,123.2 177.8,119.9 180.3,116.7 183,113.5 185.4,110.1 187.7,106.4 190,102.4 192.5,98.2 195.7,94.2 199.6,90.6 204.2,87.5 209.4,84.8 214.9,82.5 220.7,80.6 226.8,79.1 233.2,78.3 239.6,78.6 246,80 252,82.4 257.5,85.5 262.5,88.6 267.3,91.3 272,93.3 277.1,94.4 282.5,95.1 288.2,95.8 293.8,96.9 298.9,98.7 303.5,101.2 307.4,104.2 310.7,107.5 313.6,110.9 316.1,114.5 318.1,118.3 319.5,122.1 320.4,126 321.1,129.8 322,133.5 323.6,137 326.2,140.5 329.7,144.1Z" fill="none" stroke="#8fb3d9" stroke-width="4" opacity=".18" filter="url(#bloom)"/>
        </g>
      </g>

      <!-- THE MACHINE: a terminal, typing, with a face that blinks -->
      <g>
        <rect x="636" y="96" width="236" height="152" rx="12" fill="#141b25" stroke="#7fa2c4" stroke-width="1" opacity=".9"/>
        <rect x="650" y="122" width="208" height="110" rx="6" fill="#0b1016" stroke="#2a3644" stroke-width="1"/>
        <g opacity=".5">
          <circle cx="664" cy="134" r="2.6" fill="#8fb3d9"/>
          <circle cx="674" cy="134" r="2.6" fill="#8fb3d9" opacity=".7"/>
          <circle cx="684" cy="134" r="2.6" fill="#8fb3d9" opacity=".45"/>
        </g>
        <rect x="650" y="122" width="208" height="110" rx="6" fill="url(#screenglow)"/>

        <g>
          <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.06;.92;1" dur="6s" repeatCount="indefinite"/>
          <rect x="666" y="148" width="0" height="5" rx="2.5" fill="#8fb3d9" opacity="0.3"><animate attributeName="width" values="0;96" dur="1.1s" begin="0s" fill="freeze" repeatCount="indefinite"/></rect><rect x="666" y="163" width="0" height="5" rx="2.5" fill="#8fb3d9" opacity="0.4"><animate attributeName="width" values="0;132" dur="1.1s" begin="0.4s" fill="freeze" repeatCount="indefinite"/></rect><rect x="666" y="178" width="0" height="5" rx="2.5" fill="#8fb3d9" opacity="0.5"><animate attributeName="width" values="0;76" dur="1.1s" begin="0.8s" fill="freeze" repeatCount="indefinite"/></rect><rect x="666" y="193" width="0" height="5" rx="2.5" fill="#8fb3d9" opacity="0.5"><animate attributeName="width" values="0;118" dur="1.1s" begin="1.3s" fill="freeze" repeatCount="indefinite"/></rect>
          <!-- the prompt: a chevron, a caret that blinks -->
          <path d="M 666 214 l 6 5 l -6 5" fill="none" stroke="#cfe3ff" stroke-width="1.6" opacity=".8"/>
          <rect x="678" y="214" width="9" height="11" fill="#cfe3ff" opacity=".85">
            <animate attributeName="opacity" values=".85;.85;0;0" keyTimes="0;.45;.5;1" dur="1.1s" repeatCount="indefinite"/>
          </rect>
        </g>

        <!-- the face: two eyes and a mouth, because a screen that looks back is charming -->
        <g transform="translate(806,206)">
          <g>
            <animateTransform attributeName="transform" type="scale" values="1 1;1 1;1 .12;1 1" keyTimes="0;.93;.96;1" dur="5.2s" repeatCount="indefinite"/>
            <circle cx="-7" cy="0" r="2.1" fill="#cfe3ff" opacity=".9"/>
            <circle cx="7" cy="0" r="2.1" fill="#cfe3ff" opacity=".9"/>
          </g>
          <path d="M -6 7 Q 0 12 6 7" fill="none" stroke="#8fb3d9" stroke-width="1.5" stroke-linecap="round" opacity=".75"/>
        </g>

        <!-- stand -->
        <rect x="732" y="248" width="44" height="9" fill="#141b25" stroke="#2a3644" stroke-width="1"/>
        <rect x="702" y="257" width="104" height="6" rx="3" fill="#1b2532" stroke="#2a3644" stroke-width="1"/>
      </g>

      <!-- the thread they talk along: barely there, pulses as a message passes -->
      <g>
        <path d="M 344 132 C 430 92, 470 100, 540 124" fill="none" stroke="#8fb3d9" stroke-width="1" stroke-dasharray="2 7" opacity=".18">
          <animate attributeName="opacity" values=".10;.30;.10" dur="4.5s" repeatCount="indefinite"/>
        </path>
        <path d="M 540 160 C 460 200, 408 190, 348 156" fill="none" stroke="#8fb3d9" stroke-width="1" stroke-dasharray="2 7" opacity=".14">
          <animate attributeName="opacity" values=".26;.08;.26" dur="4.5s" repeatCount="indefinite"/>
        </path>
      </g>

      <!-- THE CONVERSATION: meaningless symbols, both ways -->
      <g opacity="0">
          <animateMotion dur="4.5s" begin="0s" repeatCount="indefinite" path="M 352 128 C 430 84, 470 96, 536 120"/>
          <animate attributeName="opacity" values="0;0.95;0.95;0" keyTimes="0;0.12;0.76;1" dur="4.5s" begin="0s" repeatCount="indefinite"/>
          <g transform="scale(1.0)">
            <rect x="-14" y="-11" width="28" height="22" rx="9" fill="#1b2532" stroke="#7fa2c4" stroke-width=".7" opacity=".92"/>
            <path d="M0,-4.2 L1.3,-1.3 L4.2,0 L1.3,1.3 L0,4.2 L-1.3,1.3 L-4.2,0 L-1.3,-1.3 Z" fill="#cfe3ff" opacity=".95"/>
          </g>
        </g><g opacity="0">
          <animateMotion dur="4.5s" begin="-2.2s" repeatCount="indefinite" path="M 352 128 C 430 84, 470 96, 536 120"/>
          <animate attributeName="opacity" values="0;0.95;0.95;0" keyTimes="0;0.12;0.76;1" dur="4.5s" begin="-2.2s" repeatCount="indefinite"/>
          <g transform="scale(1.0)">
            <rect x="-14" y="-11" width="28" height="22" rx="9" fill="#1b2532" stroke="#7fa2c4" stroke-width=".7" opacity=".92"/>
            <circle r="2.1" fill="#cfe3ff" opacity=".95"/>
          </g>
        </g><g opacity="0">
          <animateMotion dur="4.5s" begin="-1.0s" repeatCount="indefinite" path="M 536 158 C 462 198, 410 186, 356 152"/>
          <animate attributeName="opacity" values="0;0.95;0.95;0" keyTimes="0;0.12;0.76;1" dur="4.5s" begin="-1.0s" repeatCount="indefinite"/>
          <g transform="scale(1.0)">
            <rect x="-14" y="-11" width="28" height="22" rx="9" fill="#1b2532" stroke="#7fa2c4" stroke-width=".7" opacity=".92"/>
            <path d="M-3.4,2.2 A3.6,3.6 0 0 1 3.4,-1.6" fill="none" stroke="#cfe3ff" stroke-width="1.5" stroke-linecap="round" opacity=".95"/>
          </g>
        </g><g opacity="0">
          <animateMotion dur="4.5s" begin="-3.3s" repeatCount="indefinite" path="M 536 158 C 462 198, 410 186, 356 152"/>
          <animate attributeName="opacity" values="0;0.95;0.95;0" keyTimes="0;0.12;0.76;1" dur="4.5s" begin="-3.3s" repeatCount="indefinite"/>
          <g transform="scale(1.0)">
            <rect x="-14" y="-11" width="28" height="22" rx="9" fill="#1b2532" stroke="#7fa2c4" stroke-width=".7" opacity=".92"/>
            <path d="M0,-4 L4,3 L-4,3 Z" fill="none" stroke="#cfe3ff" stroke-width="1.3" opacity=".9"/>
          </g>
        </g>

      <rect width="900" height="282" fill="url(#vign)"/>
    </g>
  </svg>
<h1>llama-chat &mdash; a brain in the room</h1>
<p class="dim">llama.cpp b9585 · GGUFs from Desktop\\llms · this node</p>
<p>Pick a brain, start it, talk to it. Nothing is sent anywhere. <b>Karma</b> <span class="k">5</span></p>

<h2>What it makes</h2>
<p>Text: an answer, a draft, a translation, an argument. The vision model also reads an image you hand it. The output is a stream, not a file.</p>

<h2>What it needs here</h2>
<ul><li>The RX 6800 for the layers (11 GB is comfortable for the 9B at Q8 with a 32k span).</li>
<li>The GGUF you choose must be <b>on disk</b> in <code>Desktop\\llms</code> &mdash; three are.</li>
<li>The card must be free: stop the image or video service first. One job per GPU is how this box behaves &mdash; override it if you know better.</li></ul>

<h2>What it costs</h2>
<p>Load: <span class="num">seconds</span> for the 1.7B, up to about a minute for the 9B. Then the answer streams at whatever rate the card produces tokens &mdash; no queue, no per-word billing, no rate limit.</p>

<h2>Where the output lands</h2>
<p>Nowhere: it streams to the page or the API caller. <code>http://192.168.1.123:8080/v1/chat/completions</code> is OpenAI-shaped, so any client that speaks it will work.</p>

<div class="rule"></div>
<h2>How to start it</h2>
<p><b>Prepare this serve</b>, pick the brain, press run. A <b>Follow gui</b> button appears &mdash; that is the chat page.</p>
</div>`,
    inputs: `<style>
  .sv { font: 14px/1.65 system-ui, -apple-system, Segoe UI, sans-serif; color: #d8dee9; background: #0d1117; padding: 20px; max-width: 760px; }
  .sv h1 { font-size: 19px; font-weight: 600; margin: 0 0 4px; }
  .sv h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #8fb3d9; margin: 20px 0 6px; }
  .sv .dim { color: #7d8998; } .sv code { font: 12px ui-monospace, Consolas, monospace; color: #c9d3df; }
  .sv .box { border-left: 2px solid #2a323d; padding: 2px 0 2px 12px; margin: 10px 0; }
</style>
<div class="sv">
<h1>The way in &mdash; llama-chat</h1>
<p class="dim">Which brain, how much span, which port.</p>

<h2>Pick the brain</h2>
<ul><li><b>Qwen3.8-9B-Q8_0</b> &mdash; the default. Best judgement here; about 9 GB on the card.</li>
<li><b>Qwen2.5-VL-7B-Instruct-Q5_K_S</b> &mdash; reads images too; llmctl attaches the matching mmproj.</li>
<li><b>Bonsai-1.7B</b> &mdash; tiny and instant, for plumbing and quick checks.</li></ul>

<h2>Watch the span</h2>
<div class="box">Context is memory. llmctl's own default is 262144 tokens, which is far more than a 16 GB card wants for a 9B model. Start at 32k and raise it only with the VRAM in front of you.</div>

<h2>What you will see</h2>
<p>The wrapper prints the load, then the server line with its port. That is when the <b>Follow gui</b> button becomes useful: the chat page at <code>127.0.0.1:8080</code>.</p>

<h2>Stopping it</h2>
<p>Stop on this page kills the server through the wrapper &mdash; the same thing <code>llmctl.ps1 -action stop</code> does. Do it before starting an image or video run.</p>
</div>`,
  },
  progress: { how: 'the wrapper prints the load and then the listening line; after that the answer streams inside the gui, not on stdout', source: 'stdout', pattern: 'listening' },
};
