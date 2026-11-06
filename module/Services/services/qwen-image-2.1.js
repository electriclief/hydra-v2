// qwen-image-2.1 — stills from text on this node (RX 6800 16GB, Vulkan0).
// Comments may lead; the single data assignment follows. Loaded as DATA, never executed.
module.exports = {
  name: 'qwen-image-2.1',
  version: '0.1.0',
  task: 'text-to-image',
  tasks: ['text-to-image'],
  advert: {
    what: 'A prompt becomes a picture, on this machine, with no account and nothing leaving the room. Qwen-Image-2.1 Q8_0 through stable-diffusion.cpp, weights offloaded to system RAM so the 16GB card is not the ceiling.',
    time: 'measured on this node: 16.3 s to load the model, 200.2 s to generate one 768x768 image at 30 steps (last_run.log, 2026-09-22). Through the shelf on 2026-10-26: 226 s end to end for 512x512 at 12 steps - 26.7 s load, 13.7 s per step, then VAE decode. Drafting at 512 is the fast lane; 1024x1024 spills to CPU and must not be used.',
    karma: 5,
  },
  provider: {
    name: 'stable-diffusion.cpp',
    repo: 'https://github.com/leejet/stable-diffusion.cpp',
    launch: '{{sdDir}}/sd-cli.exe --diffusion-model {{sdDir}}/models/diffusion_models/qwen_image_2.1-{{quant}}.gguf --vae {{sdDir}}/models/vae/qwen_image_2.1_vae_bf16.safetensors --llm {{sdDir}}/models/text_encoders/Qwen3VL-8B-Instruct-Q4_K_M.gguf --llm_vision {{sdDir}}/models/text_encoders/mmproj-Qwen3VL-8B-Instruct-F16.gguf --offload-to-cpu --sampling-method {{sampler}} -p "{{prompt}}" -n "{{negative}}" {{refsArg}} -W {{width}} -H {{height}} --steps {{steps}} --cfg-scale {{cfg}} --seed {{seed}} -o "{{output}}" -v',
    probe: 'sd-cli.exe --list-devices',
    update: 'unpack a newer win-vulkan-x64 release zip beside the old one and repoint sdDir at it; the models folder moves with the kit',
    note: 'refsArg is expanded by the runner to one -r "path" per reference file, and dropped when the field is empty. The launch string is what the kit actually runs; every other placeholder comes from the fields above.',
  },
  // THE WEIGHTS this service runs. Two quants of the same model, both on disk.
  models: [
    { family: 'Qwen-Image-2.1', quant: 'Q8_0', file: 'qwen_image_2.1-Q8_0.gguf',
      sha256: 'f8b244b00937f0e444a40dbf7866460871b89b30142594973b6012d1b471dc0a',
      bytes: 7687155744, role: 'quality', vramGb: 8, inputs: { quant: 'Q8_0' },
      note: 'the proven cell: 768x768, 30 steps, weights offloaded to RAM so the 16 GB card is not the ceiling. 200 s for one image.' },
    { family: 'Qwen-Image-2.1', quant: 'Q4_K', file: 'qwen_image_2.1-Q4_K.gguf',
      sha256: '29f9c83c249ff0292fb2943fceddfa2319b446601866c82a4f8be062abea72c2',
      bytes: 4197494816, role: 'smaller', vramGb: 6, inputs: { quant: 'Q4_K' },
      note: 'half the weights and a little more headroom on the card. Not the tuned cell on this node — drafts, not finals.' },
  ],

  variables: {
    init: [
      { name: 'sdDir', label: 'sd.cpp kit', type: 'text', default: 'C:/Users/User/Desktop/sd-master-74988b2-bin-win-vulkan-x64', help: 'The build with sd-cli.exe in it. This one is the Qwen-Image kit; the video kit is a different folder.' },
      { name: 'outDir', label: 'Output folder', type: 'text', default: 'C:/Users/User/Desktop/make_image/out' },
      { name: 'quant', label: 'Model quant', type: 'select', default: 'Q8_0', options: ['Q8_0', 'Q4_K'], help: 'Both are on disk. Q8_0 is the proven one on this node.' },
    ],
    input: [
      { name: 'prompt', label: 'Prompt', type: 'textarea', required: true, full: true,
        help: 'One sentence of scene usually beats a paragraph of adjectives. Double quotes are the one thing the launch cannot carry.' },
      { name: 'negative', label: 'Negative prompt', type: 'textarea', full: true,
        help: 'What should be excluded. Empty by default \u2014 the model does not need a wall of "no" words.' },
      { name: 'refs', label: 'Reference image(s) \u2014 edit mode', type: 'text', full: true,
        help: 'Optional. One path, or several separated by commas: the face and identity are kept, pose, expression, clothing and background can change.' },
      { name: 'width', label: 'Width', type: 'number', default: 768, min: 256, max: 1024, step: 64 },
      { name: 'height', label: 'Height', type: 'number', default: 768, min: 256, max: 1024, step: 64,
        help: '768x768 is the sweet spot here. 1024x1024 spills to CPU and takes 20 minutes per step.' },
      { name: 'steps', label: 'Steps', type: 'number', default: 30, min: 4, max: 50,
        help: '30 is the proven number. 12 drafts a look in well under a minute of sampling.' },
      { name: 'cfg', label: 'CFG scale', type: 'number', default: 6, min: 1, max: 12, step: 0.5 },
      { name: 'sampler', label: 'Sampler', type: 'select', default: 'euler', options: ['euler', 'euler_a', 'heun', 'dpm2', 'dpm++2m', 'lcm'],
        help: 'euler is the proven method on this node.' },
      { name: 'seed', label: 'Seed', type: 'number', default: -1,
        help: '-1 rolls a fresh seed each run; any other number reproduces that image exactly.' },
      { name: 'output', label: 'Save image as', type: 'text', role: 'output', default: 'C:/Users/User/Desktop/make_image/out/img.png',
        help: 'Leave the default and the instance keeps filenames fresh - it never overwrites.' },
    ],
    files: [],
  },
  modes: [
    {
      name: 'q8-quality',
      fits: { vramGbMin: '8', note: 'the proven cell on this node: 768x768, 30 steps, weights offloaded to RAM' },
      karma: 5,
      models: [
        { path: 'C:/Users/User/Desktop/sd-master-74988b2-bin-win-vulkan-x64/models/diffusion_models/qwen_image_2.1-Q8_0.gguf', note: 'the model in use' },
        { path: 'C:/Users/User/Desktop/sd-master-74988b2-bin-win-vulkan-x64/models/vae/qwen_image_2.1_vae_bf16.safetensors', note: 'the VAE' },
        { path: 'C:/Users/User/Desktop/sd-master-74988b2-bin-win-vulkan-x64/models/text_encoders/Qwen3VL-8B-Instruct-Q4_K_M.gguf', note: 'text encoder' },
        { path: 'C:/Users/User/Desktop/sd-master-74988b2-bin-win-vulkan-x64/models/text_encoders/mmproj-Qwen3VL-8B-Instruct-F16.gguf', note: 'vision projector - only the edit service uses it' },
      ],
      install: {
        steps: [
          'Unpack the win-vulkan-x64 release zip flat into the kit folder (sd-cli.exe at the top, not a bin/ tree).',
          'Drop the four files above under models/{diffusion_models,vae,text_encoders}.',
          'Probe it: sd-cli.exe --list-devices must name the RX 6800.',
        ],
        note: 'There is one GPU on this box, so Vulkan0 is it. The 123 node has no GTX 1650 - that warning belongs to Main.',
      },
    },
    {
      name: 'q4-draft',
      fits: { vramGbMin: '6', note: 'the smaller quant: quicker to stage, slightly softer detail' },
      karma: 4,
      models: [
        { path: 'C:/Users/User/Desktop/sd-master-74988b2-bin-win-vulkan-x64/models/diffusion_models/qwen_image_2.1-Q4_K.gguf', note: 'on disk' },
      ],
      install: { steps: ['Same kit and the same encoders. Change the quant dropdown to Q4_K.'] },
    },
  ],
  needs: { gpu: true, vramGb: 12, ramMb: 26000, cores: 4, diskGb: 12 },
  output: { kind: 'file', location: 'C:/Users/User/Desktop/make_image/out - one .png per run', description: 'a single PNG; the seed and step count come back on stdout, and the file is copied to \\\\192.168.1.100\\Receive\\images by the desktop wrapper' },
  update: { command: 'swap in a newer win-vulkan-x64 release zip and repoint sdDir', note: 'WHEN is the operator call; the how is declared here.' },
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
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 260" width="100%" role="img" aria-label="A cat in a bowler hat on drawn grass, its face changing from flat to delighted">
    <defs>
      <radialGradient id="catvign" cx="50%" cy="46%" r="70%">
        <stop offset="0%" stop-color="#0d1117" stop-opacity="0"/>
        <stop offset="62%" stop-color="#0d1117" stop-opacity="0"/>
        <stop offset="100%" stop-color="#0d1117" stop-opacity=".95"/>
      </radialGradient>
      <radialGradient id="catglow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#8fb3d9" stop-opacity=".16"/>
        <stop offset="70%" stop-color="#8fb3d9" stop-opacity=".04"/>
        <stop offset="100%" stop-color="#8fb3d9" stop-opacity="0"/>
      </radialGradient>
      <clipPath id="catclip"><rect x="0" y="0" width="900" height="260"/></clipPath>
    </defs>
    <style>

      .cat-tail, .cat-head, .cat-earL, .cat-earR, .cat-ray, .cat-blade, .cat-pawL, .cat-pawR { transform-box: fill-box; }
      .cat-tail  { transform-origin: 0% 100%; animation: catTail 3.6s ease-in-out infinite; }
      .cat-head  { transform-origin: 50% 100%; animation: catHead 4.7s ease-in-out infinite; }
      .cat-earL  { transform-origin: 100% 100%; animation: catEarL 6.4s ease-in-out infinite; }
      .cat-earR  { transform-origin: 0% 100%;   animation: catEarR 6.4s ease-in-out infinite; }
      .cat-pan   { animation: catPan 4.7s steps(1, end) infinite; }
      .cat-happy { opacity: 0; animation: catHappy 4.7s steps(1, end) infinite; }
      .cat-ray   { transform-origin: 50% 50%; animation: catSpin 48s linear infinite; }
      .cat-blade { transform-origin: 50% 100%; animation: catSway 5.4s ease-in-out infinite; }
      .cat-pawL  { transform-origin: 50% 0%; animation: catPawL 3.6s ease-in-out infinite; }
      .cat-pawR  { transform-origin: 50% 0%; animation: catPawR 3.6s ease-in-out infinite; }

      @keyframes catTail  { 0%,100% { transform: rotate(-6deg); } 50% { transform: rotate(8deg); } }
      @keyframes catHead  { 0%,100% { transform: translateY(0) rotate(0); } 50% { transform: translateY(-2px) rotate(-1.4deg); } }
      @keyframes catEarL  { 0%,93%,100% { transform: rotate(0); } 96% { transform: rotate(-10deg); } }
      @keyframes catEarR  { 0%,89%,100% { transform: rotate(0); } 92% { transform: rotate(10deg); } }
      @keyframes catPan   { 0%,49% { opacity: 1; } 50%,100% { opacity: 0; } }
      @keyframes catHappy { 0%,49% { opacity: 0; } 50%,100% { opacity: 1; } }
      @keyframes catSpin  { to { transform: rotate(360deg); } }
      @keyframes catSway  { 0%,100% { transform: rotate(-2deg); } 50% { transform: rotate(2.4deg); } }
      @keyframes catPawL  { 0%,100% { transform: rotate(0); } 50% { transform: rotate(4deg); } }
      @keyframes catPawR  { 0%,100% { transform: rotate(0); } 50% { transform: rotate(-4deg); } }

    </style>
    <g clip-path="url(#catclip)">
      <rect width="900" height="260" fill="#0d1117"/>

      <ellipse cx="450" cy="160" rx="240" ry="120" fill="url(#catglow)"/>
    
      <g>
        <circle cx="748" cy="62" r="24" fill="none" stroke="#cfe3ff" stroke-width="2.2"/>
        <g class="cat-ray" stroke="#8fb3d9" stroke-width="1.8" stroke-linecap="round"><path d="M748,28 v-11" transform="rotate(0,748,62)"/><path d="M748,28 v-11" transform="rotate(45,748,62)"/><path d="M748,28 v-11" transform="rotate(90,748,62)"/><path d="M748,28 v-11" transform="rotate(135,748,62)"/><path d="M748,28 v-11" transform="rotate(180,748,62)"/><path d="M748,28 v-11" transform="rotate(225,748,62)"/><path d="M748,28 v-11" transform="rotate(270,748,62)"/><path d="M748,28 v-11" transform="rotate(315,748,62)"/></g>
      </g>
    
      <path d="M96,214 C280,200 400,198 470,201 C580,205 700,200 812,214" fill="none" stroke="#cfe3ff" stroke-width="2.2"/>
      <g stroke="#8fb3d9" stroke-width="1.7" stroke-linecap="round" fill="none"><path class="cat-blade" d="M176,214 C172,198.4 174,191.9 178,188" style="animation-delay:-0.4s"/><path class="cat-blade" d="M198,214 C194,193.6 196,185.1 200,180" style="animation-delay:-1.7s"/><path class="cat-blade" d="M222,214 C218,200.8 220,195.3 224,192" style="animation-delay:-2.9s"/><path class="cat-blade" d="M300,214 C296,196.0 298,188.5 302,184" style="animation-delay:-1.1s"/><path class="cat-blade" d="M330,214 C326,202.0 328,197.0 332,194" style="animation-delay:-3.4s"/><path class="cat-blade" d="M640,214 C636,197.2 638,190.2 642,186" style="animation-delay:-0.8s"/><path class="cat-blade" d="M668,214 C664,192.4 666,183.4 670,178" style="animation-delay:-2.2s"/><path class="cat-blade" d="M694,214 C690,199.6 692,193.6 696,190" style="animation-delay:-1.4s"/><path class="cat-blade" d="M770,214 C766,196.0 768,188.5 772,184" style="animation-delay:-3.0s"/><path class="cat-blade" d="M796,214 C792,202.0 794,197.0 798,194" style="animation-delay:-0.6s"/></g>
      <g fill="#8fb3d9" opacity=".7">
        <circle cx="252" cy="206" r="2.2"/><circle cx="256" cy="210" r="1.6"/>
        <circle cx="620" cy="207" r="2.2"/><circle cx="616" cy="211" r="1.6"/>
      </g>
    
      <g transform="translate(450,150) scale(1.06) translate(-450,-150)">
        <!-- the tail, thicker and striped -->
        <g class="cat-tail">
          <path d="M498,204 C542,202 556,178 540,156" fill="none" stroke="#cfe3ff" stroke-width="10" stroke-linecap="round"/>
          <path d="M498,204 C542,202 556,178 540,156" fill="none" stroke="#0d1117" stroke-width="6" stroke-linecap="round"/>
          <g stroke="#cfe3ff" stroke-width="2" opacity=".85" stroke-linecap="round">
            <path d="M520,200 l2,7"/><path d="M534,190 l4,6"/><path d="M542,176 l5,4"/>
          </g>
        </g>

        <!-- body -->
        <path d="M402,214 C394,184 404,158 428,148 C440,143 460,143 472,148 C496,158 506,184 498,214 Z"
              fill="#0f1620" stroke="#cfe3ff" stroke-width="2.6"/>
        <path d="M436,158 q14,-8 28,0" fill="none" stroke="#8fb3d9" stroke-width="1.5" opacity=".7"/>

        <!-- front legs, with paws that tap -->
        <g class="cat-pawL">
          <path d="M424,176 L424,208" stroke="#cfe3ff" stroke-width="2.4" stroke-linecap="round"/>
          <ellipse cx="424" cy="211" rx="11" ry="6" fill="#0f1620" stroke="#cfe3ff" stroke-width="2.2"/>
        </g>
        <g class="cat-pawR">
          <path d="M476,176 L476,208" stroke="#cfe3ff" stroke-width="2.4" stroke-linecap="round"/>
          <ellipse cx="476" cy="211" rx="11" ry="6" fill="#0f1620" stroke="#cfe3ff" stroke-width="2.2"/>
        </g>

        <g class="cat-head">
          <!-- ears first, so the hat sits between them -->
          <path class="cat-earL" d="M418,104 L406,64 L446,86 Z" fill="#0f1620" stroke="#cfe3ff" stroke-width="2.5" stroke-linejoin="round"/>
          <path class="cat-earR" d="M482,104 L494,64 L454,86 Z" fill="#0f1620" stroke="#cfe3ff" stroke-width="2.5" stroke-linejoin="round"/>
          <path d="M419,96 L414,74 L434,86 Z" fill="#cfe3ff" opacity=".18"/>
          <path d="M481,96 L486,74 L466,86 Z" fill="#cfe3ff" opacity=".18"/>

          <!-- head -->
          <circle cx="450" cy="126" r="44" fill="#0f1620" stroke="#cfe3ff" stroke-width="2.6"/>

          <!-- the bowler, sitting low between the ears -->
          <g>
            <path d="M423,72 C423,44 477,44 477,72 Z" fill="#101821" stroke="#cfe3ff" stroke-width="2.4"/>
            <ellipse cx="450" cy="72" rx="37" ry="6.5" fill="#101821" stroke="#cfe3ff" stroke-width="2.4"/>
            <path d="M428,63 h44" stroke="#8fb3d9" stroke-width="1.6" opacity=".75"/>
          </g>

          <!-- pan face -->
          <g class="cat-pan">
            <path d="M426,120 h16 M458,120 h16" stroke="#cfe3ff" stroke-width="2.8" stroke-linecap="round"/>
            <circle cx="434" cy="126" r="2" fill="#cfe3ff"/>
            <circle cx="466" cy="126" r="2" fill="#cfe3ff"/>
            <path d="M443,142 h14" stroke="#cfe3ff" stroke-width="2.4" stroke-linecap="round"/>
          </g>

          <!-- happy face -->
          <g class="cat-happy">
            <path d="M426,124 q8,-9 16,0 M458,124 q8,-9 16,0" fill="none" stroke="#cfe3ff" stroke-width="2.8" stroke-linecap="round"/>
            <path d="M440,136 q5,7 10,0 q5,7 10,0" fill="none" stroke="#cfe3ff" stroke-width="2.4" stroke-linecap="round"/>
            <g stroke="#8fb3d9" stroke-width="1.8" stroke-linecap="round" opacity=".8">
              <path d="M418,138 h-9 M418,144 h-9"/>
              <path d="M482,138 h9 M482,144 h9"/>
            </g>
          </g>

          <!-- nose -->
          <path d="M446,132 h8 l-4,5 Z" fill="#cfe3ff" opacity=".95"/>
          <g stroke="#8fb3d9" stroke-width="1.5" stroke-linecap="round" opacity=".7">
            <path d="M422,138 h-18 M422,145 h-16"/>
            <path d="M478,138 h18 M478,145 h16"/>
          </g>
        </g>
      </g>    <rect width="900" height="260" fill="url(#catvign)"/>
    </g>
  </svg>
<h1>Qwen-Image-2.1 &mdash; stills, on the 6800</h1>
<p class="dim">stable-diffusion.cpp · Q8_0 · weights offloaded to RAM · this node</p>
<p>A prompt becomes a picture. Nothing leaves the room: no account, no queue someone else owns. <b>Karma</b> <span class="k">5</span></p>

<h2>What it makes</h2>
<p>One PNG per run, <b>768&times;768</b> by default. Photographic scenes, objects, faces, product shots. It is the general-purpose stills engine on this box.</p>

<h2>What it needs here</h2>
<ul><li>The RX 6800 (16GB) &mdash; the only GPU in this machine.</li>
<li><b>26 GB of system RAM</b> held while it runs: Q8_0 is offloaded, so RAM is the real budget, not VRAM.</li>
<li>The 74988b2 kit and its four model files. All on disk now.</li></ul>

<h2>What it costs</h2>
<p><span class="num">200 s</span> for a 768&times;768 at 30 steps, plus <span class="num">16 s</span> to load the model &mdash; the last measured run on this node. 512&times;512 drafts are the cheap lane. <b>1024&times;1024 is a trap on this card</b>: it spills to CPU and runs at ~20 minutes per step.</p>

<h2>Where the output lands</h2>
<p><code>Desktop\\make_image\\out\\img_&lt;timestamp&gt;_s&lt;seed&gt;.png</code> &mdash; and the desktop wrapper also copies it to <code>\\\\192.168.1.100\\Receive\\images</code></p>

<div class="rule"></div>
<h2>How to start it</h2>
<p><b>Prepare this serve</b>, type the prompt, press run. One render at a time &mdash; the card cannot do two.</p>
<p class="dim">Keep double quotes out of the prompt: the launch splits the command line on quotes, and a stray one truncates the prompt silently.</p>
</div>`,
    inputs: `    <style>
      html, body { margin: 0; background: #0d1117; }
      .sv { font: 14px/1.6 system-ui, -apple-system, Segoe UI, sans-serif; color: #d8dee9; background: #0d1117; padding: 20px 24px 30px; }
      .sv h2 { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .1em; color: #5ad2a0; margin: 22px 0 6px; }
      .sv h2:first-child { margin-top: 0; }
      .sv p { margin: 6px 0; max-width: 760px; }
      .sv .dim { color: #7d8998; }
      .sv pre { background: #0e1016; border-radius: 8px; padding: 11px; overflow: auto; font: 11.5px/1.55 ui-monospace, Consolas, monospace; color: #9fb0c9; margin: 8px 0; }
      .sv code { font: 11.5px ui-monospace, Consolas, monospace; color: #c9d3df; }
      .sv .box { border-left: 2px solid #2a323d; background: rgba(255,255,255,.02); padding: 9px 12px; margin: 10px 0; max-width: 760px; }
      .sv .warn { color: #ffd479; }
    </style>
    <div class="sv">
    <h2>What a run does</h2>
    <p>Model load (~16 s), one step line per denoising step, then <code>save result image 0 ... (success)</code> and <code>1/1 images saved</code>. The PNG is on disk at that moment &mdash; the page does not need to stay open, the run belongs to the wrapper.</p>
    <p class="dim">The same knobs as the image WebUI on 1234, minus the ones this card cannot survive (1024&times;1024 spills to CPU at 20 min/step).</p>

    <h2>The one rule of this page</h2>
    <div class="box"><b>No double quotes in the prompt.</b> The command is split on them, so a quote ends the prompt early and the rest is silently dropped. Single quotes and punctuation are fine.</div>

    <h2>Where it lands</h2>
    <p><code>Desktop&#92;make_image&#92;out&#92;</code> &mdash; the instance keeps the filename fresh if you leave the default, so nothing is overwritten by accident.</p>
    </div>`,
  },
  progress: { how: 'sd-cli prints one line per denoising step, then "save result image 0 ... (success)" and "N/N images saved"', source: 'stdout', pattern: 'images saved' },
};
