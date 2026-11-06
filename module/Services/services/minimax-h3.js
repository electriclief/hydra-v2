// minimax-h3 — video with an identity reference, on this node (RX 6800 16GB).
// Comments may lead; the single data assignment follows. Loaded as DATA, never executed.
module.exports = {
  name: 'minimax-h3',
  version: '0.1.0',
  task: 'image-to-video',
  tasks: ['image-to-video', 'text-to-video'],
  advert: {
    what: 'A still of a person becomes a moving shot of that same person: MiniMax-H3 ref2va keeps the face from your reference image and invents the scene around it. Three and a half seconds of video with its own generated audio track.',
    time: 'measured on this node: ~705 s per sampling step over 30 steps, so 6-7 hours per 90-frame 720x480 clip including VAE decode and the audio mux. Plan a night, not an afternoon.',
    karma: 4,
  },
  provider: {
    name: 'stable-diffusion.cpp',
    repo: 'https://github.com/leejet/stable-diffusion.cpp',
    launch: '{{sdDir}}/sd-cli.exe --diffusion-model {{sdDir}}/models/diffusion_models/minimax_h3_ref2va_pruned-Q4_K_M.gguf --vae {{sdDir}}/models/vae/minimax_h3_video_vae_fp16.safetensors --audio-vae {{sdDir}}/models/vae/minimax_h3_audio_vae_fp32.safetensors --llm {{sdDir}}/models/text_encoders/qwen3vl_32b_minimax_h3-Q4_K_M.gguf --backend llm=cpu,vae=vulkan0 --diffusion-fa --rng cpu -p "{{prompt}}" -n "{{negative}}" {{imageFlag}} "{{image}}" {{endArg}} --sampling-method {{sampler}} -W {{width}} -H {{height}} --video-frames {{frames}} --steps {{steps}} --cfg-scale {{cfg}} --fps {{fps}} --seed {{seed}} -o "{{output}}" -v',
    probe: 'sd-cli.exe --list-devices',
    update: 'unpack a newer win-vulkan-x64 zip as a new kit folder and repoint sdDir; never reorganise 813-bfbef5b\\models - this kit reaches it through a junction',
    note: 'imageFlag is -r for mode=identity (Ref2VA) and -i for mode=start-frame (FL2VA); endArg is --end-img "path" only when an end frame accompanies a start frame. Both are the runner job, not the form.',
  },
  // THE WEIGHTS this service runs. Two variants of the same model, both on disk.
  models: [
    { family: 'MiniMax-H3 ref2va', quant: 'Q4_K_M', file: 'minimax_h3_ref2va_pruned-Q4_K_M.gguf',
      sha256: '9ca1aef9f4609a56c2c751484013e1b20fe352f892122e5ab0a428fb95a7956e',
      bytes: 11420663904, role: 'identity', vramGb: 15, inputs: { variant: 'ref2va' },
      note: 'the identity model: your reference photo keeps the face. Needs the 5.2 GB video VAE, the 0.6 GB audio VAE and the 17 GB Qwen3VL-32B text encoder, all on disk in the kit.' },
    { family: 'MiniMax-H3 fl2va', quant: 'Q4_K', file: 'minimax_h3_fl2va_pruned-Q4_K.gguf',
      sha256: 'dd948e08ad0ba3c71bd42f368e283dd82e790f5122a63b276e22a3e0283d0c10',
      bytes: 11420663904, role: 'text-to-video', vramGb: 15, inputs: { variant: 'fl2va' },
      note: 'the text-only variant: no reference image at all, the scene comes from words alone. Same size, same VAE, same text encoder.' },
  ],

  variables: {
    init: [
      { name: 'sdDir', label: 'sd.cpp kit', type: 'text', default: 'C:/Users/User/Desktop/sd-master-c678dfe-bin-win-vulkan-x64', help: 'The video kit. Its models folder is a JUNCTION into sd-master-813-bfbef5b\\models - the one physical copy. Do not move or delete 813 models.' },
      { name: 'outDir', label: 'Output folder', type: 'text', default: 'C:/Users/User/Desktop/make_video/output' },
    ],
    input: [
      { name: 'mode', label: 'Mode \u2014 what your image is', type: 'select', default: 'start-frame', options: ['start-frame', 'identity'],
        help: 'start-frame (FL2VA): your image becomes the video\u2019s first frame. identity (Ref2VA): your image is the face, the scene around it is invented.' },
      { name: 'image', label: 'Image (start frame, or identity reference)', type: 'text', required: true, full: true,
        help: 'Full path to a PNG/JPG. This is either the first frame or the face that survives \u2014 the mode above says which.' },
      { name: 'end', label: 'End frame (optional)', type: 'text', full: true,
        help: 'Steers the last frame (flf2v). Only meaningful when the mode is start-frame; empty means the model chooses the ending.' },
      { name: 'prompt', label: 'Prompt', type: 'textarea', required: true, full: true,
        help: 'Describe the motion and the scene: "she slowly turns her head and smiles, wind in her hair, cinematic".' },
      { name: 'negative', label: 'Negative prompt', type: 'textarea', full: true,
        help: 'What should be excluded. Empty by default.' },
      { name: 'width', label: 'Width', type: 'number', default: 720, min: 256, max: 864, step: 8,
        help: '720 is padded to 736 internally - normal, not a bug. 864x480 is the OOM-risk size on 16 GB.' },
      { name: 'height', label: 'Height', type: 'number', default: 480, min: 256, max: 576, step: 8 },
      { name: 'frames', label: 'Frames', type: 'number', default: 90, min: 30, max: 121,
        help: '90 frames at 24 fps = 3.75 s. More frames is more hours, roughly linear.' },
      { name: 'steps', label: 'Steps', type: 'number', default: 30, min: 10, max: 40,
        help: '30 is the tuned number for this model. Do not raise it hoping for quality - it costs hours per step.' },
      { name: 'cfg', label: 'CFG scale', type: 'number', default: 1, min: 1, max: 4, step: 0.1 },
      { name: 'sampler', label: 'Sampler', type: 'select', default: 'euler', options: ['euler', 'euler_a', 'heun', 'dpm2', 'dpm++2m'],
        help: 'euler is what the tuned runs used.' },
      { name: 'fps', label: 'FPS', type: 'number', default: 24, min: 12, max: 30, muted: true },
      { name: 'seed', label: 'Seed', type: 'number', default: -1 },
      { name: 'output', label: 'Save video as', type: 'text', role: 'output', default: 'C:/Users/User/Desktop/make_video/output/h3_clip.avi',
        help: 'AVI carries the generated audio track - do not convert it away.' },
    ],
    files: [],
  },
  modes: [
    {
      name: 'ref2va-720x480',
      fits: { vramGbMin: '16', note: 'the proven cell here: 720x480, 90 frames, 30 steps, llm on CPU' },
      karma: 4,
      models: [
        { path: 'C:/Users/User/Desktop/sd-master-813-bfbef5b-bin-win-vulkan-x64/models/diffusion_models/minimax_h3_ref2va_pruned-Q4_K_M.gguf', note: 'identity reference only - the image is never a frame' },
        { path: 'C:/Users/User/Desktop/sd-master-813-bfbef5b-bin-win-vulkan-x64/models/vae/minimax_h3_video_vae_fp16.safetensors' },
        { path: 'C:/Users/User/Desktop/sd-master-813-bfbef5b-bin-win-vulkan-x64/models/vae/minimax_h3_audio_vae_fp32.safetensors', note: 'the generated audio' },
        { path: 'C:/Users/User/Desktop/sd-master-813-bfbef5b-bin-win-vulkan-x64/models/text_encoders/qwen3vl_32b_minimax_h3-Q4_K_M.gguf', note: '17 GB conditioner - CPU resident, this is the RAM budget' },
      ],
      install: {
        steps: [
          'The kit folder is flat: sd-cli.exe at the top. models is a junction to the 813 kit - keep it that way.',
          'Confirm the junction: Get-Item <kit>\\models -Force | Select LinkType,Target',
          'Probe: sd-cli.exe --list-devices names the RX 6800 as Vulkan0.',
        ],
        note: 'First-frame mode (fl2va) is a different checkpoint in the same folder; it is not this service yet.',
      },
    },
  ],
  needs: { gpu: true, vramGb: 15, ramMb: 28000, cores: 6, diskGb: 25 },
  output: { kind: 'file', location: 'C:/Users/User/Desktop/make_video/output - one .avi per run', description: 'a 3.75 s AVI at 24 fps with an audio stream; frame 0 is NOT the reference image in ref2va mode' },
  update: { command: 'new kit folder + repoint sdDir; models stay in the 813 junction', note: 'WHEN is the operator call.' },
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
  .sv .warn { border-left: 2px solid #6b4f3a; padding: 4px 0 4px 12px; margin: 10px 0; color: #cbb7a4; }
</style>
<div class="sv">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 260" width="100%" role="img" aria-label="A wide 1970s television with rabbit ears, and a stick man in a top hat walking inside it">
    <defs>
      <radialGradient id="tvvign" cx="50%" cy="46%" r="70%">
        <stop offset="0%" stop-color="#0d1117" stop-opacity="0"/>
        <stop offset="62%" stop-color="#0d1117" stop-opacity="0"/>
        <stop offset="100%" stop-color="#0d1117" stop-opacity=".95"/>
      </radialGradient>
      <radialGradient id="tvglow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#8fb3d9" stop-opacity=".16"/>
        <stop offset="70%" stop-color="#8fb3d9" stop-opacity=".04"/>
        <stop offset="100%" stop-color="#8fb3d9" stop-opacity="0"/>
      </radialGradient>
      <clipPath id="tvclip"><rect x="0" y="0" width="900" height="260"/></clipPath>
    </defs>
    <style>

      /* fill-box: the pivot is a point on the limb itself, so a scale or translate on an
         ancestor cannot fling the arm across the screen */
      .tv-fig, .tv-legA, .tv-legB, .tv-armB, .tv-armTip, .tv-hat, .tv-headg, .tv-earL, .tv-earR {
        transform-box: fill-box;
      }
      .tv-fig    { animation: tvBob 1.1s ease-in-out infinite; }
      .tv-legA   { transform-origin: 100% 0%; animation: tvLegA 1.1s cubic-bezier(.45,0,.55,1) infinite; }
      .tv-legB   { transform-origin: 0% 0%;   animation: tvLegB 1.1s cubic-bezier(.45,0,.55,1) infinite; }
      .tv-armB   { transform-origin: 100% 0%; animation: tvArmB 1.1s cubic-bezier(.45,0,.55,1) infinite; }
      .tv-armL   { transform-origin: 0% 0%;   animation: tvArmB 1.1s cubic-bezier(.45,0,.55,1) infinite reverse; }
      /* two arms swap places: the walk arms fade out, the tipping arm fades in already bent */
      .tv-armsWalk { animation: tvArmsHide 11s ease-in-out infinite; }
      .tv-armTip   { opacity: 0; animation: tvTipShow 11s ease-in-out infinite; }
      .tv-hat    { transform-origin: 50% 100%; animation: tvHat 11s ease-in-out infinite; }
      .tv-headg  { transform-origin: 50% 100%; animation: tvHead 11s ease-in-out infinite; }
      .tv-earL   { transform-origin: 100% 100%; animation: tvEarA 7s ease-in-out infinite; }
      .tv-earR   { transform-origin: 0% 100%;   animation: tvEarB 7s ease-in-out infinite; }

      @keyframes tvBob   { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-2.2px); } }
      @keyframes tvLegA  { 0%,100% { transform: rotate(15deg); } 50% { transform: rotate(-15deg); } }
      @keyframes tvLegB  { 0%,100% { transform: rotate(-15deg); } 50% { transform: rotate(15deg); } }
      @keyframes tvArmB  { 0%,100% { transform: rotate(-13deg); } 50% { transform: rotate(13deg); } }
      @keyframes tvArmsHide { 0%,40% { opacity: 1; } 46%,60% { opacity: 0; } 66%,100% { opacity: 1; } }
      @keyframes tvTipShow  { 0%,40% { opacity: 0; } 46%,60% { opacity: 1; } 66%,100% { opacity: 0; } }
      @keyframes tvHat   { 0%,44% { transform: translate(0,0) rotate(0); } 50%,56% { transform: translate(0,-8px) rotate(-11deg); } 62%,100% { transform: translate(0,0) rotate(0); } }
      @keyframes tvHead  { 0%,44% { transform: rotate(0); } 50%,58% { transform: rotate(-5deg); } 66%,100% { transform: rotate(0); } }
      @keyframes tvEarA  { 0%,100% { transform: rotate(0); } 50% { transform: rotate(2.4deg); } }
      @keyframes tvEarB  { 0%,100% { transform: rotate(0); } 50% { transform: rotate(-2.4deg); } }

    </style>
    <g clip-path="url(#tvclip)">
      <rect width="900" height="260" fill="#0d1117"/>
    <clipPath id="tv-screen"><rect x="0" y="0" width="300" height="120"/></clipPath>
      <ellipse cx="450" cy="150" rx="270" ry="130" fill="url(#tvglow)"/>

      <g transform="translate(450,150) scale(1.14) translate(-450,-150)">
        <!-- rabbit ears -->
        <g stroke="#cfe3ff" stroke-width="2.6" stroke-linecap="round" fill="none">
          <path class="tv-earL" d="M442,64 L398,22"/>
          <path class="tv-earR" d="M458,64 L502,26"/>
          <circle cx="398" cy="22" r="4.4" fill="#cfe3ff" stroke="none"/>
          <circle cx="502" cy="26" r="4.4" fill="#cfe3ff" stroke="none"/>
        </g>
        <path d="M430,68 h40" stroke="#cfe3ff" stroke-width="2.6" stroke-linecap="round"/>

        <!-- the box -->
        <rect x="244" y="64" width="412" height="144" rx="20" fill="#141c26" stroke="#cfe3ff" stroke-width="2.8"/>
        <rect x="258" y="76" width="300" height="120" rx="14" fill="#070c11" stroke="#8fb3d9" stroke-width="1.4"/>

        <!-- the dials and the speaker grille -->
        <circle cx="596" cy="104" r="21" fill="#101821" stroke="#cfe3ff" stroke-width="2.2"/>
        <path d="M596,104 L608,93" stroke="#cfe3ff" stroke-width="2.2" stroke-linecap="round"/>
        <circle cx="596" cy="160" r="15" fill="#101821" stroke="#8fb3d9" stroke-width="1.8"/>
        <path d="M596,160 L604,152" stroke="#8fb3d9" stroke-width="1.8" stroke-linecap="round"/>
        <g stroke="#8fb3d9" stroke-width="1.2" opacity=".5">
          <path d="M582,80 h28 M582,88 h28"/>
          <path d="M576,182 h40 M576,190 h40"/>
        </g>
        <!-- channel plate, the one piece of print on the front -->
        <rect x="574" y="132" width="44" height="14" rx="3" fill="#0a1016" stroke="#8fb3d9" stroke-width="1.2" opacity=".9"/>
        <g stroke="#cfe3ff" stroke-width="1.4" opacity=".55">
          <path d="M582,136 v6 M590,136 v6 M598,136 v6 M606,136 v6 M614,136 v6"/>
        </g>

        <!-- legs -->
        <g stroke="#cfe3ff" stroke-width="2.8" stroke-linecap="round" fill="none">
          <path d="M330,208 L318,242"/>
          <path d="M570,208 L582,242"/>
          <path d="M318,242 h-16"/>
          <path d="M582,242 h16"/>
        </g>
      </g>
      <g transform="translate(258,76)">
        <g clip-path="url(#tv-screen)">
          <g transform="translate(4,-30) scale(1.2)">
          
        <g class="tv-fig">
          <path class="tv-legA" d="M142,96 L132,118" stroke="#cfe3ff" stroke-width="3.2" stroke-linecap="round" fill="none"/>
          <path class="tv-legB" d="M142,96 L152,118" stroke="#cfe3ff" stroke-width="3.2" stroke-linecap="round" fill="none"/>
          <path d="M142,74 L142,96" stroke="#cfe3ff" stroke-width="3.2" stroke-linecap="round"/>
          <g class="tv-armsWalk">
            <path class="tv-armL" d="M142,74 L126,90" stroke="#cfe3ff" stroke-width="3.2" stroke-linecap="round" fill="none"/>
            <path class="tv-armB" d="M142,74 L158,90" stroke="#cfe3ff" stroke-width="3.2" stroke-linecap="round" fill="none"/>
          </g>
          <!-- the tipping arm is drawn already bent, so the hand meets the brim -->
          <path class="tv-armTip" d="M142,74 C152,66 155,54 149,45" stroke="#cfe3ff" stroke-width="3.2" stroke-linecap="round" fill="none"/>
          <g class="tv-headg">
            <circle cx="142" cy="58" r="13.5" fill="#070c11" stroke="#cfe3ff" stroke-width="2.8"/>
            <circle cx="137" cy="56" r="1.5" fill="#cfe3ff"/>
            <circle cx="147" cy="56" r="1.5" fill="#cfe3ff"/>
            <path d="M137,62 q5,4 10,0" stroke="#cfe3ff" stroke-width="1.7" fill="none" stroke-linecap="round"/>
            <g class="tv-hat">
              <rect x="130" y="32" width="24" height="14" rx="2" fill="#101821" stroke="#cfe3ff" stroke-width="2.2"/>
              <rect x="123" y="45" width="38" height="4.2" rx="2" fill="#101821" stroke="#cfe3ff" stroke-width="2"/>
              <path d="M130,41 h24" stroke="#8fb3d9" stroke-width="1.3" opacity=".7"/>
            </g>
          </g>
        </g>
          </g>
        </g>
        <g stroke="#8fb3d9" stroke-width=".55" opacity=".10">
          <path d="M0,7 h300"/><path d="M0,14 h300"/><path d="M0,21 h300"/><path d="M0,28 h300"/><path d="M0,35 h300"/><path d="M0,42 h300"/><path d="M0,49 h300"/><path d="M0,56 h300"/><path d="M0,63 h300"/><path d="M0,70 h300"/><path d="M0,77 h300"/><path d="M0,84 h300"/><path d="M0,91 h300"/><path d="M0,98 h300"/><path d="M0,105 h300"/><path d="M0,112 h300"/><path d="M0,119 h300"/>
        </g>
        <rect width="300" height="120" fill="none" stroke="#1d2833" stroke-width="1"/>
      </g>    <rect width="900" height="260" fill="url(#tvvign)"/>
    </g>
  </svg>
<h1>MiniMax-H3 &mdash; a still that moves</h1>
<p class="dim">stable-diffusion.cpp · ref2va · 720&times;480 · 90 frames · this node</p>
<p>Give it one photograph and a sentence about the motion. The face stays; the world around it is generated, including the sound. <b>Karma</b> <span class="k">4</span></p>

<h2>What it makes</h2>
<p>A <b>3.75 second</b> AVI at 24 fps with its own audio track. Identity-conditioned video &mdash; it is the same person, in a scene nobody shot.</p>

<h2>What it needs here</h2>
<ul><li>The RX 6800, and it wants nearly all of it.</li>
<li><b>28 GB of RAM</b>: the 17 GB text encoder lives on the CPU for the whole run. This machine has 32 GB, so a browser tab is real competition.</li>
<li>Nothing else on the GPU &mdash; no miner, no llama-server, no image server. One card, one job by habit, not by law.</li></ul>

<h2>What it costs</h2>
<p><span class="num">~705 s per step</span>, 30 steps, then decode and mux: <b>6 to 7 hours</b> for one clip, measured on this node. Frame count scales roughly linearly, so 121 frames is not a small bump.</p>

<h2>Where the output lands</h2>
<p><code>Desktop\\make_video\\output\\h3_&lt;W&gt;x&lt;H&gt;_&lt;frames&gt;f_ref_&lt;timestamp&gt;.avi</code></p>

<div class="rule"></div>
<h2>How to start it</h2>
<p><b>Prepare this serve</b>, paste the reference image path, describe the motion, press run. Then leave it alone.</p>
<div class="warn"><b>ref2va is identity only.</b> Your photo is never frame 1. If the scene must BE the photo, that is the other checkpoint (fl2va) and it is not this service yet.</div>
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
    <p>A load line (~30 s), then a step bar per sampling step. The log can sit stale for minutes &mdash; the bar-to-bar gap is the honest signal, not the file timestamp. At the end: <code>generate_video completed</code>, the VAE decode, then the mux.</p>
    <p class="dim">The same knobs as the video WebUI on 1235: start frame or identity, end frame, motion prompt, size, frames, steps, sampler.</p>

    <h2>Before you press run</h2>
    <div class="box">Close the browser, stop unMiner, stop any <code>llama-server</code> and any <code>sd-server</code>. The engine decides where the weights live from <b>free RAM at load time</b>; a single open browser can flip it into a segmented, 100x slower plan that dies hours later.</div>

    <h2>Where it lands</h2>
    <p><code>Desktop&#92;make_video&#92;output&#92;</code> &mdash; keep the AVI as it is; it carries the generated audio track.</p>
    </div>`,
  },
  progress: { how: 'sd-cli prints a step bar per sampling step, then "generate_video completed", the VAE decode line and the saved filename', source: 'stdout', pattern: 'completed' },
};
