#!/usr/bin/env node
/**
 * CommsNode - one node that can hear, see and speak, made of four doors that can each fail alone.
 *
 *   AudioIn  8161   microphone -> wav, with levels
 *   VideoIn  8162   camera     -> MJPEG / snapshot
 *   AudioOut 8163   text       -> speech -> speakers (piper, SAPI fallback)
 *   WakeWord 8164   "are you listening" -> POST /api/wake here
 *
 * WHY A HUB AND NOT ONE BIG MODULE: the operator asked for a lazy-loaded set. Each capability starts on its own, dies on
 * its own, and a missing camera cannot stop the microphone from working. The hub is the only thing that knows the
 * sequence, and it knows nothing about devices - it asks the doors. If a door is down, the answer says which one.
 *
 * THE LOOP (the point of the node):
 *   wake word  -> POST /api/wake -> capture N seconds -> transcribe -> (optional agent) -> speak the answer
 *
 * Every step is a POST to a door. Nothing is resident: between requests this process is a router.
 *
 *   node src/main.js --port 8160 --host 0.0.0.0 --state http://127.0.0.1:8127 --ref jims
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const argOf = (name, fallback = null) => {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');
function nodeJson() {
  for (const f of [path.join(ROOT, 'module', 'Menu', 'data', 'node.json'), path.join(ROOT, 'module', 'Core', 'data', 'node.json')]) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch { }
  }
  return {};
}
const nodeFile = nodeJson();
const comms = nodeFile.comms || {};

const PORT = Number(argOf('port', process.env.COMMSNODE_PORT ?? 8160));
const HOST = argOf('host', process.env.COMMSNODE_HOST ?? '127.0.0.1');
const REF = String(argOf('ref', comms.ref ?? nodeFile.ref ?? os.hostname()));
const STATE = String(argOf('state', comms.state ?? 'http://127.0.0.1:8127')).replace(/\/$/, '');
const AUDIOIN = String(argOf('audioin', comms.audioIn ?? 'http://127.0.0.1:8161')).replace(/\/$/, '');
const VIDEOIN = String(argOf('videoin', comms.videoIn ?? 'http://127.0.0.1:8162')).replace(/\/$/, '');
const AUDIOOUT = String(argOf('audioout', comms.audioOut ?? 'http://127.0.0.1:8163')).replace(/\/$/, '');
const WAKEWORD = String(argOf('wakeword', comms.wakeWord ?? 'http://127.0.0.1:8164')).replace(/\/$/, '');
const WHISPER = comms.whisper ?? '';
const MODEL = comms.whisperModel ?? '';
const CAPTURE = Number(comms.listenSeconds ?? 6);
const AGENT = comms.answerUrl ?? '';

const TMP = path.join(os.tmpdir(), 'hydra-comms');
fs.mkdirSync(TMP, { recursive: true });

/**
 * LAZY LOAD. Only this hub is raised at boot; the four capability doors are started on first use, through
 * ProcessWrapper, so they appear in the app with a close button like everything else. A node that is never asked to
 * listen never spawns ffmpeg, and a door that was closed on purpose comes back the next time something needs it.
 */
const PW = String(argOf('pw', comms.pw ?? 'http://127.0.0.1:8125')).replace(/\/$/, '');
const DOORS = {
  AudioIn: { port: 8161, dir: 'AudioIn', url: AUDIOIN, module: 'AudioIn' },
  VideoIn: { port: 8162, dir: 'VideoIn', url: VIDEOIN, module: 'VideoIn' },
  AudioOut: { port: 8163, dir: 'AudioOut', url: AUDIOOUT, module: 'AudioOut' },
  WakeWord: { port: 8164, dir: 'WakeWord', url: WAKEWORD, module: 'WakeWord' },
};
const NODE_EXE = process.env.HYDRA_NODE || path.join(ROOT, 'tools', 'node', 'node.exe');
const starting = new Map();

async function up(name, waitMs = 25000) {
  const d = DOORS[name];
  if (!d) return { ok: false, why: 'no_such_door', name };
  const h = await j(`${d.url}/health`, {}, 2500);
  if (h.ok) return { ok: true, already: true, url: d.url };
  if (starting.has(name)) return starting.get(name);
  const p = (async () => {
    const body = {
      name: `comms-${name.toLowerCase()}`, tag: 'comms',
      command: fs.existsSync(NODE_EXE) ? NODE_EXE : 'node',
      args: ['src/main.js', '--port', String(d.port), '--host', '0.0.0.0'],
      cwd: path.join(ROOT, 'module', d.dir),
    };
    const r = await j(`${PW}/api/processes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, 15000);
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 700));
      const probe = await j(`${d.url}/health`, {}, 2000);
      if (probe.ok) return { ok: true, started: true, pid: r.body?.process?.pid ?? null, url: d.url };
    }
    return { ok: false, why: 'door_did_not_come_up', name, pwStatus: r.status, detail: r.body };
  })();
  starting.set(name, p);
  const out = await p;
  starting.delete(name);
  return out;
}


let last = { at: null, heard: null, transcript: null, spoke: null, ms: null, error: null };
let hits = 0;

const j = async (url, opts = {}, timeout = 120000) => {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(url, { ...opts, signal: ac.signal });
    const type = r.headers.get('content-type') || '';
    const body = type.includes('json') ? await r.json() : await r.text();
    return { status: r.status, ok: r.ok, body, headers: Object.fromEntries(r.headers) };
  } catch (e) {
    return { status: 0, ok: false, body: { ok: false, why: 'unreachable', url, detail: e.message } };
  } finally { clearTimeout(t); }
};

/** Resolve whisper-cli.exe / main.exe inside whatever folder the node declared. */
function whisperExe() {
  if (!WHISPER) return null;
  if (fs.existsSync(WHISPER) && WHISPER.toLowerCase().endsWith('.exe')) return WHISPER;
  for (const name of ['whisper-cli.exe', 'main.exe', 'whisper.exe']) {
    const p = path.join(WHISPER, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** STT: local whisper if it is installed, an external URL if the node names one, otherwise a typed absence. */
function transcribe(wav, external) {
  const t0 = Date.now();
  if (external) {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-Command',
      `$f='${wav}'; $b=[IO.File]::ReadAllBytes($f); Invoke-RestMethod -Uri '${external}' -Method Post -Body $b -ContentType 'audio/wav' | ConvertTo-Json -Compress`],
      { timeout: 120000, encoding: 'utf8' });
    return { ok: r.status === 0, engine: external, transcript: String(r.stdout || '').trim(), ms: Date.now() - t0, detail: (r.stderr || '').slice(-200) };
  }
  const exe = whisperExe();
  if (!exe) return { ok: false, why: 'stt_missing', lookedFor: WHISPER || '(comms.whisper)', ms: Date.now() - t0 };
  if (!MODEL || !fs.existsSync(MODEL)) return { ok: false, why: 'model_missing', lookedFor: MODEL || '(comms.whisperModel)', ms: Date.now() - t0 };
  const r = spawnSync(exe, ['-m', MODEL, '-f', wav, '-nt', '-np'], { timeout: 300000, encoding: 'utf8' });
  const text = String(r.stdout || '').trim();
  return { ok: r.status === 0, engine: 'whisper.cpp', transcript: text, ms: Date.now() - t0, detail: (r.stderr || '').trim().slice(-200) || undefined };
}

const send = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body, null, 2));
};
const readBody = (req) => new Promise((resolve) => {
  let raw = '';
  req.on('data', (c) => { raw += c; if (raw.length > 4 << 20) req.destroy(); });
  req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
});

/** Publish what this node is, as a link plus a fact block, into its own State. A failed publish is reported, not hidden. */
async function publish() {
  const body = {
    ref: REF, at: new Date().toISOString(),
    doors: { audioIn: AUDIOIN, videoIn: VIDEOIN, audioOut: AUDIOOUT, wakeWord: WAKEWORD },
    listenSeconds: CAPTURE, stt: whisperExe() ? 'whisper.cpp' : (comms.sttUrl || 'none'),
    agent: AGENT || null, hits, last,
  };
  return j(`${STATE}/api/state/push`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: `node.${REF}.comms`, content: body, ttlMs: 120000 }),
  }, 8000);
}

/** The full loop. `wav` lets a caller hand in audio instead of using the microphone - that is how it is tested. */
async function listen({ seconds = CAPTURE, wav = null, sttUrl = null, speak = true, ask = true } = {}) {
  const t0 = Date.now();
  let file = wav;
  let level = null;
  if (!file) {
    const ready = await up('AudioIn');
    if (!ready.ok) { last = { at: new Date().toISOString(), error: ready }; return { ok: false, step: 'audioin', ...ready }; }
    const cap = await j(`${AUDIOIN}/api/capture`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seconds }),
    }, (Number(seconds) + 30) * 1000);
    if (!cap.ok) { last = { at: new Date().toISOString(), error: cap.body }; return { ok: false, step: 'capture', ...cap.body }; }
    file = cap.body.file; level = { rms: cap.body.rms, peak: cap.body.peak, silent: cap.body.silent, device: cap.body.device };
  }
  const stt = transcribe(file, sttUrl || comms.sttUrl || null);
  if (!stt.ok) { last = { at: new Date().toISOString(), error: stt }; return { ok: false, step: 'stt', ...stt }; }

  let answer = null;
  if (ask && AGENT) {
    const a = await j(AGENT, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: stt.transcript, ref: REF, at: new Date().toISOString() }),
    }, 180000);
    answer = a.ok ? (a.body.answer || a.body.text || a.body) : { ok: false, why: 'agent_failed', detail: a.body };
  }

  const spoken = answer && typeof answer === 'string' ? answer : null;
  let said = null;
  if (speak && spoken) {
    await up('AudioOut');
    const s = await j(`${AUDIOOUT}/api/say`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: spoken }),
    }, 240000);
    said = s.ok ? { provider: s.body.provider, ms: s.body.wallMs, player: s.body.player } : s.body;
  }

  last = {
    at: new Date().toISOString(), seconds, level, heard: stt.transcript, engine: stt.engine,
    transcript: stt.transcript, answer, spoke: said, ms: Date.now() - t0,
  };
  publish();
  return { ok: true, ...last };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (p === '/health') return send(res, 200, { ok: true, door: 'CommsNode', ref: REF, port: PORT });

  if (p === '/api/devices') {
    await Promise.all([up('AudioIn'), up('VideoIn'), up('AudioOut')]);
    const [a, v, o] = await Promise.all([j(`${AUDIOIN}/api/devices`, {}, 15000), j(`${VIDEOIN}/api/devices`, {}, 15000), j(`${AUDIOOUT}/api/devices`, {}, 15000)]);
    return send(res, 200, {
      ok: true, ref: REF,
      mic: a.ok ? a.body.mic : { down: AUDIOIN, detail: a.body },
      cameras: v.ok ? v.body.cameras : { down: VIDEOIN, detail: v.body },
      cameraSource: v.ok ? v.body.source : null,
      speakers: o.ok ? o.body.audio : { down: AUDIOOUT, detail: o.body },
      doors: { audioIn: a.status, videoIn: v.status, audioOut: o.status },
    });
  }

  if (p === '/api/listen' && req.method === 'POST') {
    const body = await readBody(req);
    const r = await listen(body);
    return send(res, r.ok ? 200 : 503, r);
  }

  // the wake word's landing point: the trigger is all this needs to be
  if (p === '/api/wake' && req.method === 'POST') {
    const body = await readBody(req);
    hits++;
    console.log('[comms] wake', JSON.stringify(body));
    // answer asynchronously so the recogniser is not blocked while a capture runs
    listen({ seconds: CAPTURE }).then((r) => console.log('[comms] wake loop ->', r.ok ? r.transcript : r.why)).catch(() => { });
    return send(res, 202, { ok: true, accepted: 'wake', capture: CAPTURE, at: new Date().toISOString() });
  }

  if (p === '/api/say' && req.method === 'POST') {
    const body = await readBody(req);
    await up('AudioOut');
    const s = await j(`${AUDIOOUT}/api/say`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, 240000);
    return send(res, s.status || 502, s.body);
  }

  if (p === '/api/state') return send(res, 200, { ok: true, ref: REF, hits, last, doors: { audioIn: AUDIOIN, videoIn: VIDEOIN, audioOut: AUDIOOUT, wakeWord: WAKEWORD } });

  send(res, 404, { ok: false, why: 'no_such_endpoint', path: p });
});

server.listen(PORT, HOST, () => {
  console.log(`[comms] ${REF} on ${HOST}:${PORT} -> mic ${AUDIOIN} cam ${VIDEOIN} say ${AUDIOOUT} wake ${WAKEWORD} stt ${whisperExe() ? 'whisper.cpp' : (comms.sttUrl || 'none')}`);
  publish();
  setInterval(publish, 30000);
});
