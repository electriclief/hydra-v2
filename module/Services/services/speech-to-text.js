// speech-to-text — the ear of the node.
//
// TTS was already real (:8144, kokoro with a SAPI fallback). This is the other half, and it is deliberately the CHEAP
// half: whisper.cpp on the CPU with a small model, so the box that has no GPU at all — the 4-core with 8 GB that the
// operator keeps describing — still gets a voice instead of a promise.
//
// The one shape decision that matters: any container is converted to 16 kHz mono PCM before the recogniser sees it.
// Feeding whisper a 44.1 kHz stereo mp3 works by luck; the conversion is one ffmpeg call and removes the luck.
//
// A missing binary and a silent room must never answer the same way. "MISSING whisper: <path>" is a fact about the
// install; "no speech detected" is a fact about the audio. This service keeps them apart.
module.exports = {
  name: 'speech-to-text',
  version: '0.1.0',
  schema: 2,
  dispatch: true,            // a discrete task with a start and an end: the Scheduler may book it
  task: 'transcribe',
  tasks: ['transcribe', 'speech-to-text'],

  advert: {
    what: 'Hear speech and return text. whisper.cpp on the CPU, fed 16 kHz mono WAV by ffmpeg, with a declared model so a bigger box only needs a bigger file. The ear that goes with the mouth on :8144.',
    time: 'about 10 s for a 3 s clip on 4 CPU threads with the tiny.en model; larger models trade time for accuracy',
    karma: 3,
  },

  provider: {
    name: 'whisper.cpp',
    launch: 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\\AI\\scripts\\stt.ps1 -Audio {{audio}} -Model "{{model}}" -Threads {{threads}} -Json',
    backend: 'CLI',
    update: 'download a newer whisper.cpp release, or a better ggml model — the service declaration does not change',
    note: 'The model is an INIT variable, not part of the service: ggml-tiny.en.bin is the default so a GPU-less node works out of the box, and a node with a card points the same service at a bigger file.',
  },

  // Declaration only: weights travel to the node, not with the service.
  models: [],

  needs: { gpu: false, ramMb: 1200, cores: 2, diskGb: 0 },
  whenItDoesNotFit: 'A machine without ffmpeg cannot decode input, and a machine without whisper-cli cannot recognise it — both are reported as MISSING with the path that was looked for, never as "no speech detected". Silence and a broken install must not read the same way.',

  variables: {
    init: [
      { name: 'model', type: 'text', default: 'C:\\AI\\speech\\stage\\ggml-tiny.en.bin' },
      { name: 'threads', type: 'number', default: 4 },
      { name: 'language', type: 'text', default: 'en' },
    ],
    input: [
      { name: 'audio', type: 'text', required: true },
    ],
    files: [
      { name: 'audio', kind: 'audio' },
    ],
  },

  progress: {
    how: 'stt.ps1 runs one recogniser pass and prints a single JSON line when it is done, so progress is "waiting for one line": there is no partial text to report and claiming otherwise would be noise.',
  },

  output: { kind: 'text', location: 'stdout', shape: '{ ok, text, ms, model, threads, chars }' },

  pages: {
    ad: `<h1>Hear speech, return text</h1>
<p class="lede">The mouth has been real for a while — text to speech runs on this node already. This is the ear, and it is
the cheap half on purpose: whisper.cpp on the CPU, so the machine with no graphics card still gets a voice.</p>

<h2>Why it is a service and not a script</h2>
<p>Because the fleet should be able to ask for it the same way it asks for anything else. A node advertises "I can
transcribe", a broker or a Scheduler books it, and the answer comes back as text. A tool that only one person knows how
to run is not infrastructure.</p>

<h2>What it needs</h2>
<p>No GPU. About 1.2 GB of RAM and two cores. ffmpeg on the box to decode, whisper-cli and a ggml model in place. That is
all — a four-core machine with 8 GB can hold this and still answer.</p>

<h2>The two answers it refuses to confuse</h2>
<p>A missing model says <b>MISSING model</b> and the path it looked for. A quiet room says <b>no speech</b>. Those two
sentences look alike to a careless tool, and telling them apart is the difference between a service you can trust and one
that quietly lies.</p>`,

    inputs: `<h1>Transcribe an audio file</h1>
<p class="lede">One file in, the words out. Any container ffmpeg understands — the conversion to the 16 kHz mono WAV the
recogniser wants is done for you.</p>

<form class="inputs">
  <label>Audio file
    <input name="audio" type="text" required placeholder="C:\\path\\clip.wav or clip.mp3" />
    <small>wav, mp3, m4a, flac, ogg — anything ffmpeg can decode.</small>
  </label>

  <label>Model (optional)
    <input name="model" type="text" placeholder="C:\\AI\\speech\\stage\\ggml-tiny.en.bin" />
    <small>Leave it alone and the small English model is used. A bigger file is slower and more accurate; it is the same
    service either way.</small>
  </label>

  <label>Threads
    <input name="threads" type="number" value="4" min="1" max="32" />
    <small>Four is what a four-core machine can give without stalling everything else.</small>
  </label>

  <button type="submit">Transcribe</button>
</form>

<p class="note">During a run this page carries the progress: one recogniser pass, one JSON line back. There is no partial
text to show, and inventing a progress bar that moves on its own would be worse than waiting.</p>`,
  },
};
