#!/usr/bin/env node
/**
 * AudioIn - the microphone as a door.
 *
 * One capability: a bounded recording of the default (or named) input device, returned as 16 kHz mono WAV, with the
 * level measured off the samples rather than assumed. The waveform is what an STT engine eats; the RMS is what a
 * person needs to know before blaming the recogniser for hearing nothing.
 *
 * LAZY BY CONSTRUCTION. This process holds no device: ffmpeg is spawned for the length of one capture and exits, so
 * an idle comms node costs a few MB and no microphone. Every spawn is tagged so it appears in ProcessWrapper as its
 * own row (comms-mic) instead of hiding inside this one.
 *
 * A missing microphone is a FACT, not an exception: /api/devices says which names ffmpeg enumerated, and a capture
 * with no device answers `no_mic` with the list it looked through - never a silent file of zeroes.
 *
 *   node src/main.js --port 8161 --host 0.0.0.0 --ffmpeg C:\AI\comms\ffmpeg.exe
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const argOf = (name, fallback = null) => {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..');

/** Instance paths live in node.json, never in this file: the same module runs on any node unchanged. */
function keepConfig() {
  for (const f of [path.join(ROOT, 'module', 'Menu', 'data', 'node.json'), path.join(ROOT, 'module', 'Core', 'data', 'node.json')]) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch { }
  }
  return {};
}
const node = keepConfig();
const comms = node.comms || {};

const PORT = Number(argOf('port', process.env.AUDIOIN_PORT ?? 8161));
const HOST = argOf('host', process.env.AUDIOIN_HOST ?? '127.0.0.1');
const FFMPEG = argOf('ffmpeg', comms.ffmpeg ?? 'ffmpeg');
const OUT = argOf('out', comms.tmp ?? path.join(os.tmpdir(), 'hydra-comms'));
const IDLE_MS = Number(argOf('idle-ms', 30000));

fs.mkdirSync(OUT, { recursive: true });

let deviceCache = { at: 0, mic: [] };
let lastUsed = Date.now();
let child = null;

/**
 * ffmpeg prints the device list to stderr and exits non-zero on purpose: "-list_devices true -i dummy" is a listing,
 * not a recording. Parsing its output is the only device inventory Windows gives without a native audio API.
 */
function listDevices(force = false) {
  if (!force && Date.now() - deviceCache.at < 60000) return deviceCache.mic;
  const r = spawnSync(FFMPEG, ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], { encoding: 'utf8', timeout: 15000 });
  const text = (r.stderr || '') + (r.stdout || '');
  const mic = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/"([^"]+)"\s*\(audio\)/i);
    if (m) mic.push(m[1]);
  }
  deviceCache = { at: Date.now(), mic };
  return mic;
}

const pickMic = (wanted) => {
  const mic = listDevices();
  if (wanted && mic.includes(wanted)) return wanted;
  if (mic.length === 0) return null;
  const preferred = mic.find((n) => /microphone|mic|capture/i.test(n));
  return preferred || mic[0];
};

/** 16-bit PCM RMS and peak, read from the wav we actually wrote - not from ffmpeg's opinion. */
function levels(file) {
  const buf = fs.readFileSync(file);
  const i = buf.indexOf('data', 12, 'ascii');
  if (i < 0) return { rms: 0, peak: 0, samples: 0 };
  let start = i + 8;
  const end = Math.min(buf.length, start + buf.readUInt32LE(i + 4));
  let sum = 0, peak = 0, n = 0;
  for (let p = start; p + 1 < end; p += 2) {
    const v = buf.readInt16LE(p) / 32768;
    sum += v * v; n++;
    const a = Math.abs(v); if (a > peak) peak = a;
  }
  return { rms: n ? Math.sqrt(sum / n) : 0, peak, samples: n };
}

function capture(seconds, device, outName) {
  const secs = Math.max(0.5, Math.min(60, Number(seconds) || 3));
  const dev = device || pickMic();
  if (!dev) {
    return { ok: false, why: 'no_mic', devices: listDevices(true), lookedFor: FFMPEG };
  }
  const file = path.join(OUT, outName || `mic-${Date.now()}.wav`);
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'dshow', '-i', `audio=${dev}`,
                '-t', String(secs), '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', file];
  let r = spawnSync(FFMPEG, args, { timeout: Math.ceil(secs * 1000) + 20000, encoding: 'utf8' });
  // THE DEVICE IS SHARED WITH THE WAKE LOOP. A capture that lands while the trigger is recording fails with a busy
  // device; that is a collision, not a broken microphone, so try once more before reporting anything.
  if (r.status !== 0 || !fs.existsSync(file)) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    r = spawnSync(FFMPEG, args, { timeout: Math.ceil(secs * 1000) + 20000, encoding: 'utf8' });
  }
  lastUsed = Date.now();
  if (r.status !== 0 || !fs.existsSync(file)) {
    return { ok: false, why: 'capture_failed', device: dev, detail: (r.stderr || '').trim().slice(-400), exit: r.status };
  }
  const lv = levels(file);
  const bytes = fs.statSync(file).size;
  return {
    ok: true, device: dev, file, bytes, seconds: secs,
    rms: Number(lv.rms.toFixed(5)), peak: Number(lv.peak.toFixed(5)), samples: lv.samples,
    // a working microphone in a quiet room is not 0.0; calling that success is how a muted device ships
    silent: lv.rms < 0.0005,
  };
}

const send = (res, code, body, type = 'application/json') => {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body, null, 2);
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(data);
};

const LEVEL = { cache: null, at: 0, busy: null, seconds: 1 };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (p === '/health') return send(res, 200, { ok: true, door: 'AudioIn', port: PORT, ffmpeg: FFMPEG, ffmpegFound: fs.existsSync(FFMPEG) || FFMPEG === 'ffmpeg' });

  if (p === '/api/devices') {
    const mic = listDevices(true);
    return send(res, 200, { ok: mic.length > 0, mic, ffmpeg: FFMPEG, why: mic.length ? undefined : 'no_mic' });
  }

  /**
   * ONE MEASUREMENT, SHARED. A meter on a screen asks ten times a second, and each ask spawns ffmpeg against the same
   * device - two of those at once and the second one opens a microphone that is already busy, which reads as "no mic".
   * So a sample is taken at most every 250 ms and concurrent callers wait on the same one.
   */
  if (p === '/api/level') {
    const seconds = Number(url.searchParams.get('seconds') || 1);
    const device = url.searchParams.get('device');
    const now = Date.now();
    if (LEVEL.cache && now - LEVEL.at < 250 && LEVEL.seconds === seconds) {
      return send(res, 200, { ...LEVEL.cache, cached: true, ageMs: now - LEVEL.at });
    }
    if (!LEVEL.busy) {
      LEVEL.busy = (async () => {
        const r = capture(seconds, device);
        if (!r.ok) return { ok: false, ...r };
        fs.unlink(r.file, () => { });
        return { ok: true, device: r.device, rms: r.rms, peak: r.peak, silent: r.silent };
      })().then((out) => {
        if (out.ok) { LEVEL.cache = out; LEVEL.at = Date.now(); LEVEL.seconds = seconds; }
        LEVEL.busy = null;
        return out;
      });
    }
    const r = await LEVEL.busy;
    if (!r.ok) return send(res, r.why === 'no_mic' ? 503 : 500, r);
    const { ok, ...body } = r;
    return send(res, 200, body);
  }

  if (p === '/api/capture' && req.method === 'POST') {
    const body = await readBody(req);
    const r = capture(body.seconds, body.device);
    return send(res, r.ok ? 200 : (r.why === 'no_mic' ? 503 : 500), r);
  }

  // the stream an external STT service pulls: a fresh bounded recording, as WAV, no state kept between calls
  if (p === '/api/audio') {
    const r = capture(Number(url.searchParams.get('seconds') || 5), url.searchParams.get('device'));
    if (!r.ok) return send(res, r.why === 'no_mic' ? 503 : 500, r);
    res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': fs.statSync(r.file).size, 'x-device': r.device, 'x-rms': String(r.rms) });
    fs.createReadStream(r.file).pipe(res).on('finish', () => fs.unlink(r.file, () => { }));
    return;
  }

  if (p === '/api/children') return send(res, 200, { ok: true, running: child ? child.pid : null, idleMs: IDLE_MS, idleFor: Date.now() - lastUsed });

  send(res, 404, { ok: false, why: 'no_such_endpoint', path: p });
});

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1 << 20) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
  });
}

server.listen(PORT, HOST, () => {
  console.log(`[audioin] listening on ${HOST}:${PORT} ffmpeg=${FFMPEG} out=${OUT}`);
  console.log(`[audioin] devices: ${listDevices(true).join(' | ') || '(none)'}`);
});
process.on('SIGTERM', () => { if (child) child.kill(); process.exit(0); });
