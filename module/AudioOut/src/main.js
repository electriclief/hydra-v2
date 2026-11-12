#!/usr/bin/env node
/**
 * AudioOut - the speaker as a door.
 *
 * Text in, sound out, and the answer says WHO spoke: `x-tts-provider: piper` or `sapi`. Two engines because the node
 * may be a laptop with nothing installed: piper gives a good voice, System.Speech is already on every Windows box and
 * always answers. A missing engine is reported, never faked.
 *
 * The wav is returned to the caller AND played here, because on this node the speaker is local. A caller that only
 * wanted the audio can ignore the fact that it played; a caller that wanted the room to hear it gets that too.
 *
 * Laziness: nothing is resident. piper/ffplay are spawned per request and exit. SAPI runs inside a short-lived
 * powershell. Idle cost is this process and a few MB.
 *
 *   node src/main.js --port 8163 --host 0.0.0.0 --piper C:\AI\comms\piper\piper.exe --voice C:\AI\comms\voices\x.onnx
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
function nodeJson() {
  for (const f of [path.join(ROOT, 'module', 'Menu', 'data', 'node.json'), path.join(ROOT, 'module', 'Core', 'data', 'node.json')]) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch { }
  }
  return {};
}
const node = nodeJson();
const comms = node.comms || {};

const PORT = Number(argOf('port', process.env.AUDIOOUT_PORT ?? 8163));
const HOST = argOf('host', process.env.AUDIOOUT_HOST ?? '127.0.0.1');
const PIPER = argOf('piper', comms.piper ?? '');
const VOICE = argOf('voice', comms.voice ?? '');
const FFPLAY = argOf('ffplay', comms.ffplay ?? '');
const TMP = path.join(os.tmpdir(), 'hydra-comms');
fs.mkdirSync(TMP, { recursive: true });

const piperReady = () => !!PIPER && !!VOICE && fs.existsSync(PIPER) && fs.existsSync(VOICE);
const have = (exe) => exe === 'ffplay' ? true : fs.existsSync(exe);

function sapi(text, wav) {
  const txt = wav + '.txt';
  fs.writeFileSync(txt, text, 'utf8');
  const ps = `Add-Type -AssemblyName System.Speech
$t=[IO.File]::ReadAllText('${txt.replace(/\\/g, '\\\\')}')
$s=New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SetOutputToWaveFile('${wav.replace(/\\/g, '\\\\')}')
$s.Speak($t); $s.Dispose()`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { timeout: 60000, encoding: 'utf8' });
  fs.unlink(txt, () => { });
  if (r.status !== 0 || !fs.existsSync(wav)) return { ok: false, why: 'sapi_failed', detail: (r.stderr || '').slice(-300) };
  return { ok: true };
}

function piperSay(text, wav) {
  const r = spawnSync(PIPER, ['--model', VOICE, '--output_file', wav, '--length_scale', '1.0'],
    { input: text, timeout: 120000, encoding: 'utf8' });
  // piper prints its own real-time factor to stderr; that is the honest number, not my stopwatch
  const rtf = (r.stderr || '').match(/Real-time factor:\s*([\d.]+)/i);
  if (r.status !== 0 || !fs.existsSync(wav)) return { ok: false, why: 'piper_failed', detail: (r.stderr || '').slice(-300) };
  return { ok: true, rtf: rtf ? Number(rtf[1]) : undefined };
}

function play(file) {
  // ffplay if the node has it; otherwise Windows' own SoundPlayer, which needs no binary at all for a wav
  const useFfplay = FFPLAY && (FFPLAY === 'ffplay' || fs.existsSync(FFPLAY));
  try {
    if (useFfplay) {
      const c = spawn(FFPLAY, ['-nodisp', '-autoexit', '-loglevel', 'error', file], { windowsHide: true, detached: false });
      return { ok: true, pid: c.pid, player: 'ffplay' };
    }
    const ps = `(New-Object System.Media.SoundPlayer '${file.replace(/\\/g, '\\\\')}').PlaySync()`;
    const c = spawn('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, detached: false });
    return { ok: true, pid: c.pid, player: 'soundplayer' };
  } catch (e) {
    return { ok: false, why: 'play_failed', detail: e.message };
  }
}

const send = (res, code, body, type = 'application/json') => {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body, null, 2);
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(data);
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (p === '/health') return send(res, 200, {
    ok: true, door: 'AudioOut', port: PORT,
    piper: piperReady() ? PIPER : null, voice: piperReady() ? VOICE : null,
    sapi: 'available (powershell System.Speech)', ffplay: FFPLAY,
  });

  if (p === '/api/devices') {
    const r = spawnSync(FFPLAY.includes(path.sep) ? FFPLAY : 'ffmpeg', ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], { encoding: 'utf8', timeout: 15000 });
    const text = (r.stderr || '') + (r.stdout || '');
    const audio = [];
    for (const line of text.split(/\r?\n/)) { const m = line.match(/"([^"]+)"\s*\(audio\)/i); if (m) audio.push(m[1]); }
    return send(res, 200, { ok: true, audio, speakers: audio.filter((n) => !/microphone|mic\b/i.test(n)) });
  }

  if (p === '/api/say' && req.method === 'POST') {
    const body = await readBody(req);
    const text = String(body.text || '').trim();
    if (!text) return send(res, 400, { ok: false, why: 'empty_text' });
    const started = Date.now();
    const wav = path.join(TMP, `say-${Date.now()}.wav`);
    let out = { ok: false };
    if (piperReady()) out = { ...piperSay(text, wav), provider: 'piper' };
    if (!out.ok) out = { ...sapi(text, wav), provider: 'sapi', fellBackFrom: piperReady() ? 'piper' : 'not installed' };
    if (!out.ok) return send(res, 500, out);

    const bytes = fs.statSync(wav).size;
    // duration of the audio, so the caller can see rtf without decoding the wav itself
    const seconds = Math.max(0, (bytes - 44) / 32000);
    const played = body.play === false ? { ok: false, why: 'play_not_requested' } : play(wav);
    if (body.download === true) {
      res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': bytes, 'x-tts-provider': out.provider, 'x-tts-rtf': String(out.rtf ?? '') });
      fs.createReadStream(wav).pipe(res).on('finish', () => fs.unlink(wav, () => { }));
      return;
    }
    return send(res, 200, {
      ok: true, provider: out.provider, fellBackFrom: out.fellBackFrom, text, wav,
      bytes, audioSeconds: Number(seconds.toFixed(2)), rtf: out.rtf,
      wallMs: Date.now() - started, played: played.ok, player: played.ok ? played.player : played.why,
    });
  }

  if (p === '/api/play' && req.method === 'POST') {
    const body = await readBody(req);
    const target = body.file || body.url;
    if (!target) return send(res, 400, { ok: false, why: 'nothing_to_play' });
    const r = play(target);
    return send(res, r.ok ? 202 : 500, r);
  }

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
  console.log(`[audioout] listening on ${HOST}:${PORT} piper=${piperReady() ? PIPER : 'NOT INSTALLED'} voice=${piperReady() ? VOICE : '-'} sapi=available`);
});
