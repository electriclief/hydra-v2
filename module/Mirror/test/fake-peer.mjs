#!/usr/bin/env node
/**
 * A peer that is not a peer: just enough State to be read.
 *
 * Timeline (seconds since start):
 *   0-10   alive   - the cycle advances on every read
 *   10-22  stalled - answers, but the counter is frozen
 *   22+    gone    - the socket is refused
 *
 * It exists so the three verdicts can be proven without waiting for a real laptop to close its lid.
 */
import http from 'node:http';

const PORT = Number(process.env.FAKE_PORT || 8199);
const REF = String(process.env.FAKE_REF || 'jims').toLowerCase();
const ALIVE_UNTIL = Number(process.env.FAKE_ALIVE_S || 10) * 1000;
const STALL_UNTIL = Number(process.env.FAKE_STALL_S || 22) * 1000;
const started = Date.now();

const services = {
  'llama-chat': { name: 'llama-chat', provider: 'llama.cpp', karma: 5, ready: true, modes: ['gpu-full'] },
  'whisper-stt': { name: 'whisper-stt', provider: 'whisper.cpp', karma: 2, ready: true, modes: ['transcribe'] },
};

function entryFor(suffix) {
  const t = Date.now() - started;
  const advanced = Math.floor(Math.min(t, ALIVE_UNTIL) / 1000);
  switch (suffix) {
    case 'id':
      return { ref: REF, name: 'Jims Laptop', gpu: 'GTX 1050 2 GB', modelsDir: 'C:/tools/models', ready_for: ['chat'], acting_main: true };
    case 'doors':
      return { count: 8, up: 8, doors: [] };
    case 'cycle':
      return { cycle: 100 + advanced, at: Date.now(), tickMs: 2000, uptimeSec: Math.round(t / 1000), fillPct: null, sessions: null };
    case 'services':
      return { at: new Date().toISOString(), count: Object.keys(services).length, names: Object.keys(services).sort(), services };
    default:
      if (suffix.startsWith('services.')) return services[suffix.slice('services.'.length)] || null;
      return null;
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  const t = Date.now() - started;

  if (t >= STALL_UNTIL) {
    // gone: make the caller's connect fail rather than answer with an error, which is what a sleeping box does
    req.socket.destroy();
    return;
  }

  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, mode: t < ALIVE_UNTIL ? 'alive' : 'stalled' }));
    return;
  }

  if (url.pathname === '/api/state/pull') {
    const name = url.searchParams.get('name') || '';
    const prefix = `node.${REF}.`;
    if (!name.startsWith(prefix)) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'no_such_entry' }));
      return;
    }
    const content = entryFor(name.slice(prefix.length));
    if (content === null) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'no_such_entry' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, name, at: new Date().toISOString(), full: true, content, marks: {} }));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'nothing here' }));
});

server.listen(PORT, '127.0.0.1', () => console.log(`[fake-peer] ${REF} on :${PORT} alive ${ALIVE_UNTIL / 1000}s, stall ${STALL_UNTIL / 1000}s, then gone`));
