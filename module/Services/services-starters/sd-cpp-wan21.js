// sd-cpp-wan21 — Wan2.1 video on stable-diffusion.cpp, this node (RX 6800 = Vulkan1).
// Comments may lead; the single data assignment follows. Loaded as DATA, never executed.
module.exports = {
  name: 'sd-cpp-wan21',
  version: '0.1.0',
  advert: {
    what: 'Text-to-video and image-to-video with Wan2.1. The 1.3B is the one to start on — it is the only Wan model on this node small enough to render without a fight. The 14B pair is a patience game.',
    time: 'unknown until history exists — this node has the models but has not rendered a Wan clip yet. Expect the 1.3B to be minutes and the 14B to be tens of minutes, on this disk and this CPU.',
    karma: 4,
  },
  provider: {
    name: 'stable-diffusion.cpp',
    repo: 'https://github.com/leejet/stable-diffusion.cpp',
    launch: 'D:/Models/sd-cpp/bin-master-929/sd-cli.exe -M vid_gen --diffusion-model {{model}} --vae D:/Models/sd-cpp/Wan2.1/wan_2.1_vae.safetensors --t5xxl {{clip}} --backend diffusion=vulkan1,vae=vulkan1,clip=vulkan1 --prompt-file {{promptFile}} --video-frames {{frames}} -W {{width}} -H {{height}} --steps {{steps}} --cfg-scale 5 --seed {{seed}} --fps {{fps}} -o {{output}}',
    probe: 'sd-cli.exe --list-devices',
    update: 'swap the release zip into D:/Models/sd-cpp/bin-master-929 and re-point the models junction — keep the gguf models',
  },
  variables: {
    init: [
      { name: 'sdDir', label: 'sd.cpp folder', type: 'text', default: 'D:/Models/sd-cpp/bin-master-929' },
      { name: 'modelRoot', label: 'Model root', type: 'text', default: 'D:/Models/sd-cpp' },
      { name: 'outDir', label: 'Output folder', type: 'text', default: 'D:/Models/sd-cpp/out' },
      { name: 'clip', label: 'umt5 text encoder', type: 'text', default: 'D:/Models/sd-cpp/Wan2.1/umt5-xxl-encoder-Q8_0.gguf', help: 'MANDATORY, and it goes in via --t5xxl (NOT --clip — that flag does not exist and makes sd-cli dump its help text). Nothing in Wan2.1 runs without it. This was the one file missing from the original download batch.' },
      { name: 'vae', label: 'Wan VAE', type: 'text', default: 'D:/Models/sd-cpp/Wan2.1/wan_2.1_vae.safetensors', help: 'FETCHED 2026-10-01 (253,815,318 bytes) — it was not on this drive and nothing could decode a clip without it.' },
      { name: 'device', label: 'GPU (Vulkan index)', type: 'text', default: 'vulkan1', help: 'Vulkan0 is the GTX 1650 (4GB) here, Vulkan1 is the RX 6800 (16GB). Pin vulkan1.' },
    ],
    input: [
      { name: 'prompt', label: 'Prompt', type: 'textarea', required: true, full: true },
      { name: 'firstFrame', label: 'First frame (image → video)', type: 'text', default: '', help: 'Leave empty for text-to-video. Give a full path for image-to-video — the I2V model wants one, and this is the difference between the two modes.' },
      { name: 'model', label: 'Transformer', type: 'select', default: 'wan2.1_t2v_1.3b (start here)', options: ['wan2.1_t2v_1.3b (start here)', 'wan2.1-vace-1.3b (with control)', 'wan2.1-t2v-14b Q4_K_M', 'wan2.1-i2v-14b-480p Q4_K_M', 'Wan2.1_14B_VACE Q4_K_M'], help: 'The 1.3B is 1.59GB and is the sane first run. The 14B Q4_K_M files are 10-12GB: they load, but staging on this disk is minutes and sampling is long.' },
      { name: 'width', label: 'Width', type: 'number', default: 512, min: 256, max: 1280, step: 16 },
      { name: 'height', label: 'Height', type: 'number', default: 288, min: 256, max: 1280, step: 16 },
      { name: 'frames', label: 'Frames', type: 'number', default: 41, min: 5, max: 121, step: 4, help: 'Snaps to the 4n+1 grid the model needs. 41 frames at 16fps is about 2.5 seconds of video.' },
      { name: 'steps', label: 'Steps', type: 'number', default: 20, min: 1, max: 60 },
      { name: 'cfg', label: 'CFG scale', type: 'number', default: 5, min: 1, max: 12, step: 0.5, help: 'The flag is --cfg-scale. Plain --cfg prints the help text and exits.' },
      { name: 'seed', label: 'Seed', type: 'number', default: 42, help: 'sd-cli defaults to 42 when --seed is omitted — not random. -1 rolls a fresh one.' },
      { name: 'fps', label: 'FPS', type: 'number', default: 16, min: 8, max: 30 },
    ],
    files: [],
  },
  modes: [
    {
      name: 't2v-1.3b',
      fits: { note: 'the sane first run on this node — 1.59GB, fits the 6800 with room to spare' },
      karma: 5,
      models: [
        { url: 'https://huggingface.co/calcuis/wan-1.3b-gguf/resolve/main/wan2.1_t2v_1.3b-q8_0.gguf', note: '1.59GB — on disk' },
        { url: 'https://huggingface.co/city96/umt5-xxl-encoder-gguf/resolve/main/umt5-xxl-encoder-Q8_0.gguf', note: '6.04GB text encoder — on disk, and required' },
      ],
      install: {
        steps: [
          'sd-cli.exe from the win-vulkan-x64 release zip.',
          'Junction the kit models folder at D:/Models/sd-cpp.',
          'Copy wan_2.1_vae.safetensors (253MB) from node 123 or Robert into D:/Models/sd-cpp/Wan2.1.',
        ],
        fallback: ['The VACE 1.3B sits next to it at 2.37GB if you want control input as well.'],
        note: 'The umt5 encoder is not optional — its absence is a hard stop, not a fallback.',
      },
    },
    {
      name: 't2v-14b',
      fits: { note: 'full quality text-to-video; 10-18GB transformer, needs --offload-to-cpu to stage on 16GB' },
      karma: 4,
      models: [
        { url: 'https://huggingface.co/city96/Wan2.1-T2V-14B-gguf/resolve/main/wan2.1-t2v-14b-Q4_K_M.gguf', note: '10.12GB — on disk' },
        { url: 'https://huggingface.co/city96/Wan2.1-T2V-14B-gguf/resolve/main/wan2.1-t2v-14b-Q8_0.gguf', note: '15.88GB — on disk' },
      ],
      install: { steps: ['Add --offload-to-cpu.', 'Drop to 4-8 steps with a distilled build if you find it too slow; stock 14B wants 20-30.'] },
    },
    {
      name: 'i2v-14b',
      fits: { note: 'image-to-video at 480p — needs a first frame, and clip_vision_h for the image path' },
      karma: 4,
      models: [
        { url: 'https://huggingface.co/city96/Wan2.1-I2V-14B-480P-gguf/resolve/main/wan2.1-i2v-14b-480p-Q4_K_M.gguf', note: '11.34GB — on disk' },
        { url: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/clip_vision/clip_vision_h.safetensors', note: '1.26GB — on disk, needed for the I2V path' },
      ],
      install: { steps: ['Pass the first frame with -i.', 'Add --clip_vision pointing at clip_vision_h.safetensors.'] },
    },
    {
      name: 'vace-14b',
      fits: { note: 'VACE — video plus a control signal (depth, pose, edge)' },
      karma: 3,
      models: [
        { url: 'https://huggingface.co/QuantStack/Wan2.1_14B_VACE-GGUF/resolve/main/Wan2.1_14B_VACE-Q4_K_M.gguf', note: '11.64GB — on disk' },
        { url: 'https://huggingface.co/calcuis/wan-1.3b-gguf/resolve/main/wan2.1-vace-1.3b-q8_0.gguf', note: '2.37GB — the small VACE' },
      ],
      install: { steps: ['The VACE control input goes in as a video or image plus its mask — see the upstream docs/wan.md.'] },
    },
  ],
  needs: { gpu: true, vramGb: 10, ramMb: 16000, cores: 4, diskGb: 12 },
  output: { kind: 'file', location: 'D:/Models/sd-cpp/out — one .mp4 per run', description: 'a video clip; the seed, frame count and step count come back on stdout' },
  update: { command: 'swap in a newer win-vulkan-x64 release zip; keep the models junction', note: 'WHEN to update is the user\'s and Echidna\'s call — the how is declared right here.' },
  pages: {
    ad: `<style>
  .svc { font: 14px/1.6 system-ui, sans-serif; color: #d8dee9; background: #10141a; padding: 20px; max-width: 760px; }
  .svc h1 { font-size: 20px; margin: 0 0 2px; } .svc h2 { font-size: 15px; margin: 20px 0 6px; color: #9ecbff; }
  .svc .dim { color: #7b8794; } .svc pre { background: #1b232e; padding: 10px 12px; border-radius: 6px; overflow-x: auto; font: 12px/1.5 Consolas, monospace; white-space: pre-wrap; }
  .svc .k { background: #3b4a5c; padding: 1px 7px; border-radius: 10px; font-size: 12px; }
  .svc .warn { background: #3a2320; border-left: 3px solid #d08770; padding: 8px 12px; margin: 10px 0; }
  </style>
  <div class="svc">
  <h1>Wan2.1 — text and image to video</h1>
  <p class="dim">sd.cpp master-929 · RX 6800 (Vulkan1) · 10 models, 97GB on this drive</p>
  <p>Real video from a sentence, or from a picture plus a sentence. <b>Karma:</b> <span class="k">4</span></p>
  <h2>Start at the 1.3B</h2>
  <pre>wan2.1_t2v_1.3b-q8_0.gguf   1.59 GB   <-- begin here
wan2.1-vace-1.3b-q8_0.gguf  2.37 GB   the 1.3B with control input
umt5-xxl-encoder-Q8_0.gguf  6.04 GB   the text encoder — REQUIRED
wan2.1-t2v-14b-Q4_K_M        10.12 GB
wan2.1-t2v-14b-Q8_0         15.88 GB
wan2.1-i2v-14b-480p-Q4_K_M  11.34 GB   image to video
wan2.1-i2v-14b-480p-Q8_0    18.14 GB
Wan2.1_14B_VACE-Q4_K_M      11.64 GB
Wan2.1_14B_VACE-Q8_0        18.66 GB
clip_vision_h.safetensors    1.26 GB   needed by the I2V path</pre>
  <h2>The one file that was missing</h2>
  <div class="warn">The original download batch left out <b>umt5-xxl-encoder-Q8_0.gguf</b>. Wan2.1 has no other text encoder, so without it every Wan model on this drive is a paperweight. It is downloaded now (6.04GB), but if you ever see a Wan launch die at load, check that file first.</div>
  <h2>Also still needed: the VAE</h2>
  <p><b>wan_2.1_vae.safetensors was not on this drive</b> — it lives on node 123 and Robert. It has now been fetched (253,815,318 bytes) into D:/Models/sd-cpp/Wan2.1. Before this was sorted, no Wan model on this drive could have decoded a frame.</p>
  <h2>Three traps, all handled for you</h2>
  <div class="warn"><b>Vulkan0 is the GTX 1650 (4GB).</b> This box has two GPUs. Every launch here pins <b>vulkan1</b> = the RX 6800.</div>
  <div class="warn"><b>--cfg is not a flag any more</b> — it is <b>--cfg-scale</b>. Passing --cfg makes sd-cli print its help text and exit; that looks like a hang but is not one.</div>
  <div class="warn"><b>The umt5 encoder is --t5xxl, not --clip.</b> There is no --clip flag. Getting this wrong prints the help text and exits — again, it looks like a hang and is not. This one was found by running it, not by reading.</div>
  <h2>Size is the lever, and this box is honest about it</h2>
  <p>Start 512x288x41 at 20 steps on the 1.3B. Every step up — more pixels, more frames, the 14B — costs real time on an i7-2600 with a 3.5GB Q4 file to stage off disk. Read the compute-buffer line in the log before you commit to a big cell: if it says more than one segment, the graph is spilling to CPU and the run will crawl.</p>
  </div>`,
    inputs: `<style>
  .svc { font: 14px/1.6 system-ui, sans-serif; color: #d8dee9; background: #10141a; padding: 20px; max-width: 760px; }
  .svc h1 { font-size: 20px; margin: 0 0 2px; } .svc pre { background: #1b232e; padding: 10px 12px; border-radius: 6px; overflow-x: auto; font: 12px/1.5 Consolas, monospace; white-space: pre-wrap; }
  .svc .dim { color: #7b8794; }
  </style>
  <div class="svc">
  <h1>The way in — Wan2.1</h1>
  <p>Prompt, size, frames, seed. <b>The progress rides on this page</b> while it runs — a line per step, the clip at the end.</p>
  <pre>cd D:/Models/sd-cpp/bin-master-929
sd-cli.exe -M vid_gen --diffusion-model D:/Models/sd-cpp/Wan2.1/wan2.1_t2v_1.3b-q8_0.gguf --vae D:/Models/sd-cpp/Wan2.1/wan_2.1_vae.safetensors --t5xxl D:/Models/sd-cpp/Wan2.1/umt5-xxl-encoder-Q8_0.gguf --backend diffusion=vulkan1,vae=vulkan1,clip=vulkan1 --prompt-file &lt;prompt.txt&gt; --video-frames 41 -W 512 -H 288 --steps 20 --cfg-scale 5 --seed 42 --fps 16 -o D:/Models/sd-cpp/out/clip.mp4</pre>
  <p>Your prompt goes in a <b>file</b>, not on the command line. That is not fussiness — it is the whole quoting class of bugs gone: quotes, ampersands and pipes in a prompt cannot desync a command line.</p>
  <p>Inputs: <b>prompt</b> · <b>firstFrame</b> (empty = text-to-video, a path = image-to-video) · <b>model</b> · <b>width/height</b> · <b>frames</b> (snaps to 4n+1) · <b>steps</b> · <b>cfg</b> · <b>seed</b> · <b>fps</b>.</p>
  <p class="dim">Omitting --seed does NOT randomise — sd-cli defaults to 42. Image-to-video needs the I2V model, not the T2V one, and clip_vision_h for the image. The encoder flag is --t5xxl; there is no --clip.</p>
  </div>`,
  },
  progress: { how: 'sd-cli prints a sampling line per step, then "save result video" / "N/N images saved"; the compute-buffer line up front says whether it fit in VRAM', source: 'stdout' },
};
