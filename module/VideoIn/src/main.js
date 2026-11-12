#!/usr/bin/env node
/**
 * VideoIn - the camera as a door.
 *
 * Two shapes, one door: a local DirectShow camera (laptop webcam) or an ipwebcam-style URL (a phone pointed at a room).
 * The source is a node fact, so it lives in node.json ("comms": {"camera": "..."}), not in this file.
 *
 * MJPEG is the stream format on purpose: every browser and every VLC can render it, it needs no negotiation, and a
 * frame is a complete JPEG - so a dropped connection costs one frame, not a session.
 *
 * The camera is spawned per subscriber and killed when that subscriber leaves: a door that holds the device open
 * forever is the reason a webcam is "busy" in every other app on the machine.
 *
 *   node src/main.js --port 8162 --host 0.0.0.0 --ffmpeg C:\AI\comms\ffmpeg.exe
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

const PORT = Number(argOf('port', process.env.VIDEOIN_PORT ?? 8162));
const HOST = argOf('host', process.env.VIDEOIN_HOST ?? '127.0.0.1');
const FFMPEG = argOf('ffmpeg', comms.ffmpeg ?? 'ffmpeg');
const FPS = Number(argOf('fps', comms.cameraFps ?? 10));
const CONFIGURED = argOf('source', comms.camera ?? '');

let cache = { at: 0, cams: [] };
const viewers = new Set();

function listCameras(force = false) {
  if (!force && Date.now() - cache.at < 60000) return cache.cams;
  const r = spawnSync(FFMPEG, ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], { encoding: 'utf8', timeout: 15000 });
  const text = (r.stderr || '') + (r.stdout || '');
  const cams = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/"([^"]+)"\s*\(video\)/i);
    if (m) cams.push(m[1]);
  }
  cache = { at: Date.now(), cams };
  return cams;
}

/**
 * Resolve what to open. A URL is used as-is (ipwebcam, an RTSP camera, another node's MJPEG); a bare name is a
 * DirectShow device. With nothing configured, take the first enumerated camera instead of failing on an empty config.
 */
function source() {
  if (CONFIGURED) {
    if (/^(https?|rtsp):\/\//i.test(CONFIGURED)) return { kind: 'url', value: CONFIGURED };
    return { kind: 'dshow', value: CONFIGURED };
  }
  const cams = listCameras();
  const preferred = cams.find((c) => /webcam|camera|integrated|usb/i.test(c)) || cams[0];
  return preferred ? { kind: 'dshow', value: preferred } : null;
}

const inputArgs = (src) => (src.kind === 'url' ? ['-i', src.value] : ['-f', 'dshow', '-i', `video=${src.value}`]);

function snapshot() {
  const src = source();
  if (!src) return { ok: false, why: 'no_camera', cameras: listCameras(true) };
  const file = path.join(os.tmpdir(), `hydra-snap-${Date.now()}.jpg`);
  const args = ['-hide_banner', '-loglevel', 'error', '-y', ...inputArgs(src), '-frames:v', '1', '-q:v', '4', file];
  const r = spawnSync(FFMPEG, args, { timeout: 25000, encoding: 'utf8' });
  if (r.status !== 0 || !fs.existsSync(file)) {
    return { ok: false, why: 'capture_failed', source: src.value, detail: (r.stderr || '').trim().slice(-300) };
  }
  return { ok: true, file, bytes: fs.statSync(file).size, source: src.value, kind: src.kind };
}

const send = (res, code, body, type = 'application/json') => {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body, null, 2);
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(data);
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (p === '/health') return send(res, 200, { ok: true, door: 'VideoIn', port: PORT, ffmpeg: FFMPEG, viewers: viewers.size });

  if (p === '/api/devices') {
    const cams = listCameras(true);
    const src = source();
    return send(res, 200, {
      ok: cams.length > 0 || !!CONFIGURED, cameras: cams, configured: CONFIGURED || null,
      source: src ? src.value : null, why: (cams.length || CONFIGURED) ? undefined : 'no_camera',
    });
  }

  if (p === '/api/snapshot') {
    const r = snapshot();
    if (!r.ok) return send(res, r.why === 'no_camera' ? 503 : 500, r);
    res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': r.bytes, 'x-source': r.source });
    fs.createReadStream(r.file).pipe(res).on('finish', () => fs.unlink(r.file, () => { }));
    return;
  }

  if (p === '/api/video') {
    const src = source();
    if (!src) return send(res, 503, { ok: false, why: 'no_camera', cameras: listCameras(true) });
    // a URL source is already a stream: hand the caller to it rather than transcoding for no reason
    if (src.kind === 'url') { res.writeHead(302, { location: src.value }); return res.end(); }

    res.writeHead(200, {
      'content-type': 'multipart/x-mixed-replace; boundary=frameboundary',
      'cache-control': 'no-store', 'x-source': src.value,
    });
    const child = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...inputArgs(src),
      '-r', String(FPS), '-f', 'mjpeg', '-q:v', '6', '-'], { windowsHide: true });
    viewers.add(child.pid);
    let buf = Buffer.alloc(0);
    child.stdout.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      // frames are delimited by JPEG SOI/EOI; a partial frame stays buffered until its tail arrives
      for (;;) {
        const s = buf.indexOf(Buffer.from([0xff, 0xd8]));
        if (s < 0) { buf = Buffer.alloc(0); break; }
        const e = buf.indexOf(Buffer.from([0xff, 0xd9]), s + 2);
        if (e < 0) { buf = buf.subarray(s); break; }
        const frame = buf.subarray(s, e + 2);
        buf = buf.subarray(e + 2);
        if (!res.writableEnded) {
          res.write(`--frameboundary\r\ncontent-type: image/jpeg\r\ncontent-length: ${frame.length}\r\n\r\n`);
          res.write(frame); res.write('\r\n');
        }
      }
    });
    const stop = () => { try { child.kill('SIGKILL'); } catch { } viewers.delete(child.pid); };
    req.on('close', stop); res.on('close', stop); res.on('error', stop);
    child.on('exit', stop);
    return;
  }

  send(res, 404, { ok: false, why: 'no_such_endpoint', path: p });
});

server.listen(PORT, HOST, () => {
  const src = source();
  console.log(`[videoin] listening on ${HOST}:${PORT} ffmpeg=${FFMPEG}`);
  console.log(`[videoin] cameras: ${listCameras(true).join(' | ') || '(none)'} -> ${src ? src.value : 'none'}`);
});
