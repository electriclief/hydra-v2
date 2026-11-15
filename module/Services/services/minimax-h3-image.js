// minimax-h3-image -- stills from text (and from reference images) on this node.
// RX 6800 16GB, Vulkan0, MiniMax-H3-Image day-0 support in stable-diffusion.cpp.
// Comments may lead; the single data assignment follows. Loaded as DATA, never executed.
module.exports = {
  name: 'minimax-h3-image',
  version: '0.1.0',
  task: 'text-to-image',
  tasks: ['text-to-image', 'image-to-image'],
  advert: {
    what: 'A prompt becomes a picture with MiniMax-H3-Image, running locally on the 16GB card. Six steps, not thirty: this model carries its own PDD heads and a fixed six-step sigma schedule, so a 1024x1024 still is six sampling steps and one VAE decode. The 20GB INT8 checkpoint does not fit in VRAM, so it streams from RAM while the Qwen3-VL-32B text encoder stays on the CPU.',
    time: 'measured on this node 2026-11-12: 580.56 s for one 1024x1024 image at 6 steps, seed 42 (sampling 435.05 s of which step 1 is 372 s, VAE decode 65.92 s). Through sd-server, warm: 553.25 s (sampling 406.22 s, VAE 67.84 s). Steady state is 12.4 s per step; the first step pays the weight sweep because 20,091MB cannot be resident in 16GB. Identical inputs and seed reproduce the file byte-for-byte (md5 4dd91b819fed250e27640b2de9cf77ba).',
    karma: 4,
  },
  provider: {
    name: 'stable-diffusion.cpp',
    repo: 'https://github.com/leejet/stable-diffusion.cpp',
    build: 'master-1088-32d516c',
    backend: 'vulkan',
    launch: '{{sdDir}}/sd-cli.exe -M img_gen --diffusion-model {{diTDir}}/{{ditFile}} --vae {{diTDir}}/minimax_h3_image_vae_fp16.safetensors --llm {{sdDir}}/models/text_encoders/qwen3vl_32b_minimax_h3-Q4_K_M.gguf -p "{{prompt}}" {{refsArg}} --cfg-scale {{cfg}} --steps {{steps}} --sampling-method euler --sigmas minimax-h3-image -W {{width}} -H {{height}} --seed {{seed}} --rng cpu --offload-to-cpu --backend te=cpu --flash-attn off,diffusion=on --vae-tiling --conditioning-cache-size 8 -v -o "{{output}}"',
    probe: '{{sdDir}}/sd-cli.exe --list-devices',
    update: 'unpack a newer win-vulkan-x64 release zip beside the old one and repoint sdDir at it; the weights live outside the kit and do not move',
    note: 'steps must stay 6 -- --sigmas minimax-h3-image is the model\'s own six-step schedule and the PDD output heads are trained for it. refsArg expands to one -r "path" per reference image. te=cpu is the module name for the text encoder (llm=cpu is not a module). The encoder weights are 17.4GB and live in RAM; the DiT lives on E: and streams.',
  },
  models: [
    { family: 'MiniMax-H3-Image', quant: 'int8_convrot', file: 'minimax_h3_image_pruned_int8_convrot.safetensors',
      bytes: 20979314802, role: 'quality', vramGb: 16, inputs: { ditFile: 'minimax_h3_image_pruned_int8_convrot.safetensors' },
      note: 'the WORKING cell on this build. 20,979,314,802 bytes verified. i8 tensors: 200, bf16: 271, f16: 51.' },
    { family: 'MiniMax-H3-Image', quant: 'w4a8', file: 'minimax_h3_image_pruned_w4a8.safetensors',
      bytes: 12549794530, role: 'unusable', vramGb: 13, inputs: { ditFile: 'minimax_h3_image_pruned_w4a8.safetensors' },
      note: 'WOULD fit 16GB and be fast, but this build refuses it: "invalid packed INT4 scales/codebook for tensor blocks.0.attn.out_proj.weight". Documented as a failure, not offered as a mode.' },
    { family: 'MiniMax-H3-Image', quant: 'Q4_K_M (third-party GGUF)', file: 'MiniMax-H3-Image-Pruned-Q4_K_M.gguf',
      bytes: 11573106304, role: 'unusable', vramGb: 12, inputs: { ditFile: 'MiniMax-H3-Image-Pruned-Q4_K_M.gguf' },
      note: 'also fits, also refused: "failed to build model runners: invalid MiniMax-H3 output head shape" -- the conversion keeps ComfyUI flattened PDD heads (576->96->24) and this build has no pdd override.' },
  ],

  variables: {
    init: [
      { name: 'sdDir', label: 'sd.cpp kit', type: 'text', default: 'E:/AI/sd-cpp', help: 'The H3-Image-capable build (master-1088 or newer). sd-cli.exe and sd-server.exe sit at the top of this folder.' },
      { name: 'diTDir', label: 'Weights folder', type: 'text', default: 'F:/03-MODELS/sd-cpp/H3-Image', help: 'Off C: by contract. Holds the DiT and the image VAE.' },
      { name: 'outDir', label: 'Output folder', type: 'text', default: 'E:/AI/sd-cpp/out' },
    ],
    input: [
      { name: 'prompt', label: 'Prompt', type: 'textarea', required: true, full: true,
        help: 'Describe scene, light and lens. Prompt expansion is NOT part of the model - the H3 wrapper can hand the prompt to DeepSeek first (-Expand) if you want it rewritten before the encoder sees it.' },
      { name: 'refs', label: 'Reference image(s)', type: 'text', full: true,
        help: 'Optional. One path or several separated by commas. Enables image-to-image conditioning; the runner uses the qwen preset for reference images.' },
      { name: 'width', label: 'Width', type: 'number', default: 1024, min: 512, max: 1024, step: 64 },
      { name: 'height', label: 'Height', type: 'number', default: 1024, min: 512, max: 1024, step: 64,
        help: '1024x1024 is the measured cell on this node. There is no CPU-spill cliff here the way Qwen-Image has one: every step streams from RAM regardless.' },
      { name: 'steps', label: 'Steps', type: 'number', default: 6, min: 6, max: 6,
        help: 'Fixed at 6. The sigmas preset and the PDD heads are the six-step schedule; other values are not a tuning knob.' },
      { name: 'cfg', label: 'CFG scale', type: 'number', default: 1, min: 1, max: 4, step: 0.5,
        help: 'The model is trained at 1.0. Raising it is not the way to get more prompt adherence here.' },
      { name: 'seed', label: 'Seed', type: 'number', default: -1,
        help: '-1 rolls fresh; any other number reproduces that image exactly, byte for byte.' },
      { name: 'output', label: 'Save image as', type: 'text', role: 'output', default: 'E:/AI/sd-cpp/out/img.png',
        help: 'Leave the default and the instance keeps filenames fresh - it never overwrites.' },
    ],
    files: [],
  },

  modes: [
    {
      name: 'int8-convrot',
      fits: { vramGbMin: '16', note: 'the only cell this build can load; 20,091MB of DiT streams through a 16GB card' },
      karma: 4,
      models: [
        { path: 'F:/03-MODELS/sd-cpp/H3-Image/minimax_h3_image_pruned_int8_convrot.safetensors', note: 'the diffusion model in use' },
        { path: 'F:/03-MODELS/sd-cpp/H3-Image/minimax_h3_image_vae_fp16.safetensors', note: 'the image VAE' },
        { path: 'C:/Users/User/Desktop/sd-master-813-bfbef5b-bin-win-vulkan-x64/models/text_encoders/qwen3vl_32b_minimax_h3-Q4_K_M.gguf', note: 'text encoder, 17.4GB, runs on the CPU' },
      ],
      install: {
        steps: [
          'Unpack the win-vulkan-x64 release zip flat into the kit folder (sd-cli.exe and sd-server.exe at the top, no wrapper directory).',
          'Put the INT8 ConvRot diffusion model and the image VAE under the weights folder.',
          'Probe it: sd-cli.exe --list-devices must name the RX 6800 with fp16:1, bf16:0.',
          'First run: h3img.ps1 -Dry prints the exact command without touching the card.',
        ],
        note: 'RAM matters more than VRAM here: 20.1GB DiT + 17.4GB encoder + 1.1GB VAE is a 38.6GB working set. On a 32GB box step 1 costs ~370 s while it pages; on 64GB it does not.',
      },
    },
  ],

  needs: { gpu: true, vramGb: 16, ramMb: 28000, cores: 8, diskGb: 24 },

  output: {
    kind: 'file',
    location: 'E:/AI/sd-cpp/out - one .png per run',
    description: 'a single PNG; the seed, step count and timings come back on stdout',
  },

  update: {
    command: 'swap in a newer win-vulkan-x64 release zip and repoint sdDir',
    note: 'a newer build is the only route to the 12.55GB w4a8 quant, which would fit VRAM and be genuinely fast; watch leejet releases for packed INT4 codebook support.',
  },

  pages: {
    ad: `<style>
      html, body { margin: 0; background: #0d1117; }
      .sv { font: 14px/1.65 system-ui, -apple-system, Segoe UI, sans-serif; color: #d8dee9; background: #0d1117; padding: 18px 24px 30px; max-width: none; }
      .sv h1 { font-size: 21px; font-weight: 600; margin: 16px 0 2px; letter-spacing: -0.01em; }
      .sv h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #8fb3d9; margin: 22px 0 6px; }
      .sv p { margin: 6px 0; } .sv .dim { color: #7d8998; }
      .sv .num { font-variant-numeric: tabular-nums; color: #e6edf3; }
      .sv .rule { height: 1px; background: #1c232c; margin: 18px 0; }
      .sv p, .sv ul { max-width: 720px; }
      .sv ul { margin: 6px 0 6px 18px; padding: 0; } .sv li { margin: 3px 0; }
      .sv .box { border-left: 2px solid #2a323d; background: rgba(255,255,255,.02); padding: 9px 12px; margin: 10px 0; max-width: 720px; }
      .sv .warn { color: #ffd479; }
    </style>
    <div class="sv">
    <h1>MiniMax-H3-Image</h1>
    <p class="dim">A prompt becomes a picture, on this machine, with no account and nothing leaving the room. Day-0 support in stable-diffusion.cpp.</p>

    <h2>Why six steps</h2>
    <p>This model carries its own PDD output heads and a fixed six-step sigma schedule. Six is not a speed setting you can trade down &mdash; it is what the weights were trained for. Thirty steps would be six wasted ones.</p>

    <div class="rule"></div>
    <h2>What it cost here (RX 6800, 16GB)</h2>
    <ul>
      <li>one 1024&times;1024 image, 6 steps, seed 42 &mdash; <span class="num">580.56 s</span> cold, <span class="num">553.25 s</span> warm through sd-server</li>
      <li>sampling <span class="num">12.4 s</span> per step at steady state; the first step pays <span class="num">~370 s</span> because 20,091MB cannot sit in 16GB of VRAM</li>
      <li>VAE decode <span class="num">66 s</span>, 49 tiles</li>
      <li>the same seed and prompt reproduce the file byte for byte</li>
    </ul>

    <h2>The honest limit</h2>
    <div class="box"><span class="warn">Two smaller formats would fit the card outright and be genuinely fast &mdash; the 12.55GB w4a8 and an 11.57GB Q4_K_M GGUF &mdash; and this build refuses both: packed INT4 codebooks and ComfyUI&rsquo;s flattened PDD heads. What is offered here is the one that loads.</span></div>

    <h2>What it needs</h2>
    <p>16GB of VRAM, and more RAM than VRAM: the DiT, the 17.4GB Qwen3-VL encoder and the VAE are a 38.6GB working set, which is comfortable on 64GB and pays for itself in paging on 32GB.</p>
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
    <p>Model load, then one line per denoising step out of six, then <code>save result image 0 ... (success)</code> and <code>1/1 images saved</code>. The PNG is on disk at that moment &mdash; the page does not need to stay open, the run belongs to the wrapper.</p>
    <p class="dim">Expect the long silence at the start: the first step is where every weight is staged. On a 32GB box that is minutes, not seconds.</p>

    <h2>The one rule of this page</h2>
    <div class="box"><b>Steps stay at 6.</b> The sigma preset and the PDD heads are the six-step schedule; any other number samples a model in a shape it was not trained for.</div>

    <h2>Prompt expansion is not included</h2>
    <p>The model conditions on exactly what you type. If you want richer text, the H3 wrapper can hand your prompt to DeepSeek first (<code>h3img.ps1 -Expand</code>) and feed the expanded version to the local encoder &mdash; that is a text step, not a model feature.</p>

    <h2>Where it lands</h2>
    <p><code>E:\\AI\\sd-cpp\\out\\</code> &mdash; the instance keeps filenames fresh if you leave the default, so nothing is overwritten by accident.</p>

    <h2>No double quotes in the prompt</h2>
    <p class="dim">The command is split on them, so a quote ends the prompt early. Single quotes and punctuation are fine.</p>
    </div>`,
  },
  progress: {
    how: 'sd-cli prints one line per denoising step (N/6), then "save result image 0 ... (success)" and "N/N images saved"',
    source: 'stdout',
    pattern: 'images saved',
  },
};
