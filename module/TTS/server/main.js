/**
 * TTS — a speech door that can live on any node.
 *
 *   node server/main.js [--port 8144] [--worker 8145]
 *
 * The point of this module: speech is a SERVICE, not a library call in the app. Any node can host it, the Menu
 * lights it up like every other service, and Echidna asks whoever is free. Two providers, tried in order:
 *
 *   1. kokoro  — the cast's own voices (media/voice/kokoro), loaded once in a python worker: ~1.4x realtime on CPU,
 *                far faster on a GPU node. This is the one that sounds like the show.
 *   2. sapi    — Windows built in (System.Speech). Never the best voice in the room, always available: a laptop with
 *                no GPU and no service still talks instead of going silent.
 *
 *   GET  /health                  → which providers are live, and why the other one is not
 *   POST /say {text, voice, speed} → audio/wav  (kokoro), or audio/wav from SAPI when kokoro is down
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_SCRIPT = path.join(MODULE_DIR, 'server', 'kokoro_worker.py');
const SAPI_SCRIPT = path.join(MODULE_DIR, 'server', 'sapi.ps1');
const VOICES_FILE = path.join(MODULE_DIR, 'data', 'voices.json');

const argv = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const PORT = Number(argOf('--port', '8144'));
const HOST = argOf('--host', '0.0.0.0');
const WORKER_PORT = Number(argOf('--worker', '8145'));
const PYTHON = process.env.TTS_PYTHON || 'python';

const state = { worker: null, workerUp: false, workerError: null, lastSayMs: null, said: 0 };

function loadVoices() {
  try {
    return JSON.parse(fs.readFileSync(VOICES_FILE, 'utf8'));
  } catch {
    return { note: 'no voices.json: only the default voice is available', characters: {} };
  }
}

/** Start the Kokoro worker once, and only once: the model load is 3.5 s and belongs to boot, not to a request. */
function startWorker() {
  if (state.worker) return;
  const env = { ...process.env, TTS_WORKER_PORT: String(WORKER_PORT) };
  const child = spawn(PYTHON, [WORKER_SCRIPT], { env, windowsHide: true });
  state.worker = child;
  child.stderr?.on('data', (b) => process.stderr.write(String(b)));
  child.on('exit', (code) => {
    state.worker = null;
    state.workerUp = false;
    state.workerError = `kokoro worker exited ${code}`;
    process.stderr.write(`[tts] ${state.workerError}\n`);
  });
  child.on('error', (error) => {
    state.worker = null;
    state.workerUp = false;
    state.workerError = `could not start ${PYTHON}: ${error.message}`;
  });
}

async function probeWorker() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`http://127.0.0.1:${WORKER_PORT}/health`, { signal: controller.signal });
    clearTimeout(timer);
    const body = await res.json();
    state.workerUp = Boolean(body.ok);
    state.workerError = body.error ?? null;
    return body;
  } catch (error) {
    state.workerUp = false;
    state.workerError = error.message;
    return { ok: false, error: state.workerError };
  }
}

/** Kokoro, through the worker: the voice that matches the show. */
async function sayKokoro(text, voice, speed) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  const res = await fetch(`http://127.0.0.1:${WORKER_PORT}/say`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, voice, speed }),
    signal: controller.signal,
  });
  clearTimeout(timer);
  if (!res.ok) {
    const why = await res.json().catch(() => ({ error: `worker answered ${res.status}` }));
    throw new Error(why.error || `worker answered ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Windows built in. A file out, because SAPI will not hand us bytes on stdout. */
function saySapi(text, voiceName) {
  return new Promise((resolve, reject) => {
    const file = path.join(os.tmpdir(), `hydra-tts-${Date.now()}-${Math.floor(Math.random() * 1e6)}.wav`);
    const args = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      SAPI_SCRIPT,
      '-Text',
      text,
      '-Out',
      file,
      ...(voiceName ? ['-Voice', voiceName] : []),
    ];
    const child = spawn('powershell', args, { windowsHide: true });
    let err = '';
    child.stderr?.on('data', (b) => (err += String(b)));
    child.on('error', reject);
    child.on('close', (code) => {
      try {
        if (code !== 0) return reject(new Error(`sapi exited ${code}: ${err.trim().slice(0, 300)}`));
        const buf = fs.readFileSync(file);
        fs.unlink(file, () => {});
        resolve(buf);
      } catch (error) {
        reject(error);
      }
    });
  });
}

function sendJson(res, code, body) {
  const raw = JSON.stringify(body, null, 2);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(raw);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c.toString('utf8');
      if (data.length > 200_000) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (url.pathname === '/health') {
      const worker = await probeWorker();
      sendJson(res, 200, {
        ok: true,
        door: 'tts',
        host: os.hostname(),
        providers: {
          kokoro: { up: state.workerUp, voice: 'cast presets', error: state.workerError, model: worker.error ? null : 'kokoro-v1.0.onnx' },
          sapi: { up: process.platform === 'win32', voice: 'Windows built in (System.Speech)' },
        },
        voices: loadVoices(),
        said: state.said,
        lastSayMs: state.lastSayMs,
      });
      return;
    }

    if (url.pathname === '/say' && (req.method ?? 'GET').toUpperCase() === 'POST') {
      let body;
      try {
        body = JSON.parse((await readBody(req)) || '{}');
      } catch {
        sendJson(res, 400, { ok: false, error: 'body must be JSON' });
        return;
      }
      const text = String(body.text ?? '').trim();
      if (!text) {
        sendJson(res, 400, { ok: false, error: 'nothing to say' });
        return;
      }
      const voices = loadVoices();
      const character = body.character ? voices.characters?.[String(body.character)] : null;
      const voice = String(body.voice ?? character?.kokoro ?? 'af_sky');
      const speed = Number(body.speed ?? character?.speed ?? 1.04);
      const started = Date.now();
      const allowSapi = body.fallback !== false;

      try {
        if (!state.workerUp) await probeWorker();
        if (state.workerUp) {
          const wav = await sayKokoro(text, voice, speed);
          state.said += 1;
          state.lastSayMs = Date.now() - started;
          res.writeHead(200, {
            'content-type': 'audio/wav',
            'x-tts-provider': 'kokoro',
            'x-tts-voice': voice,
            'x-tts-ms': String(state.lastSayMs),
          });
          res.end(wav);
          return;
        }
        throw new Error(state.workerError ?? 'kokoro is not up');
      } catch (error) {
        if (!allowSapi) {
          sendJson(res, 503, { ok: false, error: `kokoro failed: ${error.message}` });
          return;
        }
        try {
          const wav = await saySapi(text, character?.sapi);
          state.said += 1;
          state.lastSayMs = Date.now() - started;
          res.writeHead(200, {
            'content-type': 'audio/wav',
            'x-tts-provider': 'sapi',
            'x-tts-fallback': 'kokoro unavailable',
            'x-tts-ms': String(state.lastSayMs),
          });
          res.end(wav);
          return;
        } catch (fallbackError) {
          sendJson(res, 503, {
            ok: false,
            error: `no voice available: kokoro (${error.message}); sapi (${fallbackError.message})`,
          });
        }
      }
      return;
    }

    sendJson(res, 404, { ok: false, error: 'no such route', path: url.pathname });
  })().catch((error) => {
    try {
      sendJson(res, 500, { ok: false, error: error.message });
    } catch {
      /* socket gone */
    }
  });
});

startWorker();
server.listen(PORT, HOST, () => {
  process.stdout.write(`[tts] http://${HOST}:${PORT} (worker ${WORKER_PORT}, voices ${VOICES_FILE})\n`);
});
