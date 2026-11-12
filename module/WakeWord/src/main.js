#!/usr/bin/env node
/**
 * WakeWord - the "Are you listening" trigger.
 *
 * Why a grammar and not a model: on this laptop a model-based keyword spotter means running whisper over 2-second
 * chunks, and whisper here is ~2x slower than realtime - it would fall further behind every minute. Windows ships a
 * recogniser that spots a fixed phrase instantly and needs no weights, so the trigger is a grammar and the *listening
 * that follows* is the expensive part that only runs when the trigger fires. That is the whole point of a wake word.
 *
 * Three honest states, never a fourth:
 *    sleeping  - no recogniser running, no microphone held
 *    armed     - recogniser live, holding the microphone, waiting for the phrase
 *    failed    - the recogniser could not start, with the reason (no_mic, no_speech_engine, child_exit)
 *
 * On a hit it POSTs {phrase, text, confidence, at} to the hub's /api/wake, which is what starts a capture. This door
 * never records anything itself.
 *
 * File mode exists so the trigger can be tested without a person: POST /api/test {wav} runs the same phrase matcher
 * over a transcript of that file, which proves the detection logic separately from the microphone.
 *
 *   node src/main.js --port 8164 --host 0.0.0.0 --hub http://127.0.0.1:8160
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const argOf = (name, fallback = null) => {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = path.resolve(HERE, '..', '..', '..');
function nodeJson() {
  for (const f of [path.join(ROOT, 'module', 'Menu', 'data', 'node.json'), path.join(ROOT, 'module', 'Core', 'data', 'node.json')]) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch { }
  }
  return {};
}
const node = nodeJson();
const comms = node.comms || {};

const PORT = Number(argOf('port', process.env.WAKEWORD_PORT ?? 8164));
const HOST = argOf('host', process.env.WAKEWORD_HOST ?? '127.0.0.1');
const HUB = String(argOf('hub', comms.hub ?? 'http://127.0.0.1:8160')).replace(/\/$/, '');
const PHRASE = String(argOf('phrase', comms.wakePhrase ?? 'are you listening')).toLowerCase();
const WHISPER = argOf('whisper', comms.whisper ?? '');
const MODEL = argOf('model', comms.whisperModel ?? '');
const AUTO = String(argOf('auto', comms.wakeAuto ?? 'false')) === 'true';
const SCRIPT = path.join(HERE, '..', 'scripts', 'wake.ps1');
const AUDIOIN = String(argOf('audioin', comms.audioIn ?? 'http://127.0.0.1:8161')).replace(/\/$/, '');
const MODE = String(argOf('mode', comms.wakeMode ?? 'auto'));
const CHUNK = Number(argOf('chunk', comms.wakeChunkSeconds ?? 3));

let child = null;
let loopTimer = null;
let armedAt = 0;
let hits = 0;
let lastHit = null;
let lastHeard = null;
let chunks = 0;
let failure = null;

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Tolerant match: "are you listening", "are you listenin", "are you listening?" all count. */
function matches(text) {
  const t = norm(text);
  const words = PHRASE.split(' ');
  const stems = words.map((w) => (w.length > 6 ? w.slice(0, 6) : w));
  const joined = stems.join(' ');
  return t.includes(PHRASE) || t.includes(joined) || (t.includes('are you') && t.includes('listen'));
}

/**
 * Two triggers, chosen by what the node can actually do:
 *   grammar - Windows System.Speech, instant and free, but it rejects synthetic and accented speech more often
 *             than a person expects. Measured here: a piper voice saying the phrase was heard by the microphone
 *             (whisper transcribed it perfectly) and the grammar still did not fire.
 *   stt     - the same whisper the listener uses, over N-second chunks. On this laptop whisper runs at RTF ~0.18,
 *             so a chunk is transcribed in a fraction of the time it took to record and the loop keeps up.
 * 'auto' picks stt when whisper is installed, grammar otherwise.
 */
function arm() {
  if (child || loopTimer) return { ok: true, already: true, pid: child ? child.pid : null };
  const mode = MODE === 'auto' ? (whisperExe() && MODEL && fs.existsSync(MODEL) ? 'stt' : 'grammar') : MODE;
  armedAt = Date.now();
  failure = null;
  if (mode === 'grammar') {
    if (!fs.existsSync(SCRIPT)) { failure = 'wake.ps1 missing at ' + SCRIPT; return { ok: false, why: 'no_script', detail: failure }; }
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Phrase', PHRASE], { windowsHide: true });
    } catch (e) {
      failure = 'spawn failed: ' + e.message;
      return { ok: false, why: 'spawn_failed', detail: failure };
    }
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (line.startsWith('HIT')) {
          const [, text = '', conf = ''] = line.split('\t');
          hit(text, Number(conf) || null);
        } else if (line.startsWith('FAIL')) { failure = line.slice(4).trim(); console.log('[wakeword] recogniser said', failure); }
      }
    });
    child.on('exit', (code) => { console.log('[wakeword] recogniser exited', code); child = null; });
    return { ok: true, pid: child.pid, phrase: PHRASE, mode };
  }

  // STT mode: capture a chunk, transcribe it, match it. Sequential on purpose - a second capture while the first is
  // still transcribing would fight for the same microphone.
  const tick = async () => {
    if (!loopTimer) return;
    let heard = '';
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), (CHUNK + 15) * 1000);
      const cap = await fetch(`${AUDIOIN}/api/capture`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seconds: CHUNK }), signal: ac.signal,
      });
      clearTimeout(timer);
      const capBody = await cap.json();
      if (capBody.ok) {
        const r = spawnSync(whisperExe(), ['-m', MODEL, '-f', capBody.file, '-nt'], { timeout: 120000, encoding: 'utf8' });
        heard = String(r.stdout || '').trim();
        chunks++;
        // what the loop is actually hearing, so "it never fires" can be read instead of guessed at
        lastHeard = { text: heard, at: new Date().toISOString(), chunk: chunks };
        fs.unlink(capBody.file, () => { });
        if (heard && matches(heard)) hit(heard, null);
      } else {
        failure = capBody.why || 'capture_failed';
      }
    } catch (e) {
      failure = 'loop: ' + e.message;
    }
    if (loopTimer) loopTimer = setTimeout(tick, 150);
  };
  loopTimer = setTimeout(tick, 100);
  return { ok: true, phrase: PHRASE, mode: 'stt', chunkSeconds: CHUNK };
}

function hit(text, confidence) {
  hits++;
  lastHit = { text, confidence, at: new Date().toISOString() };
  console.log('[wakeword] HIT', text, confidence ?? '');
  fetch(HUB + '/api/wake', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phrase: PHRASE, text, confidence, at: lastHit.at }),
  }).catch((e) => console.log('[wakeword] hub did not take the hit:', e.message));
}

function disarm() {
  if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }
  if (child) { try { child.kill('SIGKILL'); } catch { } child = null; }
  return { ok: true, already: false };
}

/**
 * File mode: transcribe a wav with whisper (if present) and run the same matcher. This is how the trigger is tested
 * without a human in the room - the microphone path and the detection path are separate failures.
 */
function whisperExe() {
  if (!WHISPER) return null;
  if (fs.existsSync(WHISPER) && WHISPER.toLowerCase().endsWith('.exe')) return WHISPER;
  for (const n of ['whisper-cli.exe', 'main.exe', 'whisper.exe']) {
    const p = path.join(WHISPER, n);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function testFile(file) {
  const exe = whisperExe();
  if (!exe) return { ok: false, why: 'whisper_missing', lookedFor: WHISPER || '(comms.whisper)' };
  if (!MODEL || !fs.existsSync(MODEL)) return { ok: false, why: 'model_missing', lookedFor: MODEL || '(comms.whisperModel)' };
  if (!fs.existsSync(file)) return { ok: false, why: 'no_such_file', file };
  const t0 = Date.now();
  const r = spawnSync(exe, ['-m', MODEL, '-f', file, '-nt'], { timeout: 180000, encoding: 'utf8' });
  if (r.error) return { ok: false, why: 'spawn_failed', detail: r.error.message, exe, file };
  const heard = String(r.stdout || '').trim();
  return {
    ok: true, file, heard, matched: matches(heard), phrase: PHRASE,
    ms: Date.now() - t0, exit: r.status, stderr: (r.stderr || '').trim().slice(-200) || undefined,
  };
}

const send = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body, null, 2));
};
const readBody = (req) => new Promise((resolve) => {
  let raw = '';
  req.on('data', (c) => { raw += c; if (raw.length > 1 << 20) req.destroy(); });
  req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (p === '/health') return send(res, 200, { ok: true, door: 'WakeWord', port: PORT, phrase: PHRASE, state: (child || loopTimer) ? 'armed' : (failure ? 'failed' : 'sleeping'), mode: MODE });
  if (p === '/api/status') return send(res, 200, {
    ok: true, state: (child || loopTimer) ? 'armed' : (failure ? 'failed' : 'sleeping'), mode: MODE, phrase: PHRASE,
    pid: child ? child.pid : null, armedForMs: child ? Date.now() - armedAt : 0, hits, lastHit, lastHeard, chunks, failure,
  });
  if (p === '/api/arm' && req.method === 'POST') { const r = arm(); return send(res, r.ok ? 200 : 500, r); }
  if (p === '/api/disarm' && req.method === 'POST') return send(res, 200, disarm());
  if (p === '/api/test' && req.method === 'POST') {
    const body = await readBody(req);
    const r = testFile(body.wav || url.searchParams.get('wav'));
    return send(res, r.ok ? 200 : 503, r);
  }
  send(res, 404, { ok: false, why: 'no_such_endpoint', path: p });
});

server.listen(PORT, HOST, () => {
  console.log(`[wakeword] listening on ${HOST}:${PORT} phrase="${PHRASE}" auto=${AUTO}`);
  if (AUTO) { const r = arm(); console.log('[wakeword] auto-arm:', JSON.stringify(r)); }
});
process.on('SIGTERM', () => { disarm(); process.exit(0); });
