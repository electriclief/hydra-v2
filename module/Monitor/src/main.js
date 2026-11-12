// Monitor :8157 - the board you can read, and the agent you can reach.
//
// What it does:
//   GET  /                 the slideshow page (one slide per Train of Thought topic)
//   GET  /api/topics       every topic: title, state, intent, unanswered questions, key messages
//   GET  /api/agent        is there an agent to click into? (Hermes gateway on 8642)
//   POST /api/ask          {"ref":"...","question":"..."} -> a REAL agent run, answer returned
//
// Two rules this door keeps:
//   - A click never goes to a dead link. The agent is probed; if it is not there the button says so.
//   - The gateway key is read at call time from the owner's own .env and is never logged, never sent to a page.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

function argOf(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PORT = Number(argOf('port', 8157));
const HOST = argOf('host', '0.0.0.0');
const THOUGHTS = argOf('thoughts', 'C:/AI/hydra-local/module/TrainOfThought/data/thoughts.json');
const GATEWAY = argOf('gateway', 'http://127.0.0.1:8642');
const ENV_FILE = argOf('env', 'C:/Users/User/AppData/Local/hermes/.env');
const KEY_NAME = 'API_SERVER_KEY';
const STATE_URL = argOf('state', 'http://127.0.0.1:8127');
const ASK_TIMEOUT_MS = Number(argOf('ask-timeout', 180000));
const MAX_ASK = 40; // a board is not a chat app; forty runs a minute is plenty

// ---------------------------------------------------------------- topics
function readTopics() {
  let raw;
  try { raw = fs.readFileSync(THOUGHTS, 'utf8'); }
  catch (e) { return { ok: false, why: 'unreadable', path: THOUGHTS, detail: e.message }; }
  let doc;
  try { doc = JSON.parse(raw); }
  catch (e) { return { ok: false, why: 'torn', path: THOUGHTS, detail: e.message }; }
  const nodes = Array.isArray(doc.nodes) ? doc.nodes : Object.values(doc.nodes || {});
  const rank = { active: 0, open: 1, blocked: 2, parked: 3, done: 4 };
  const topics = nodes.filter(n => n && n.ref).map(n => {
    const trail = (n.trail || []).filter(t => t && t.text);
    return {
      ref: n.ref,
      title: n.title || n.ref,
      state: n.state || 'unknown',
      tags: n.tags || [],
      intent: n.intent || '',
      touched: n.touched || null,
      questions: (n.next || []).filter(Boolean),
      messages: trail.slice(-3).reverse().map(t => ({
        kind: t.kind || 'note',
        at: t.at || null,
        text: String(t.text).replace(/\s+/g, ' ').trim()
      })),
      trailCount: trail.length
    };
  }).sort((a, b) => (rank[a.state] ?? 9) - (rank[b.state] ?? 9) || (b.touched || 0) - (a.touched || 0));
  const counts = {};
  for (const t of topics) counts[t.state] = (counts[t.state] || 0) + 1;
  return { ok: true, path: THOUGHTS, generatedAt: new Date().toISOString(), counts, topics };
}

// ---------------------------------------------------------------- the agent
let agentCache = { at: 0, value: null };

function readKey() {
  try {
    const text = fs.readFileSync(ENV_FILE, 'utf8');
    const m = text.match(new RegExp('^\\s*' + KEY_NAME + '\\s*=\\s*(.+)$', 'm'));
    if (!m) return '';
    return m[1].trim().replace(/^["']|["']$/g, '');
  } catch { return ''; }
}

async function probeAgent(force) {
  const now = Date.now();
  if (!force && agentCache.value && now - agentCache.at < 5000) return agentCache.value;
  const key = readKey();
  let value = { ok: false, alive: false, door: GATEWAY, key: key ? 'present' : 'absent', keyName: KEY_NAME };
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 2500);
    const res = await fetch(GATEWAY + '/health', { signal: ac.signal });
    clearTimeout(timer);
    const j = await res.json().catch(() => ({}));
    value = {
      ok: res.ok, alive: res.ok && key !== '',
      door: GATEWAY, platform: j.platform || null, version: j.version || null,
      key: key ? 'present' : 'absent', keyName: KEY_NAME,
      why: res.ok ? (key ? null : 'no_key') : 'unhealthy'
    };
  } catch (e) {
    value.why = e.name === 'AbortError' ? 'timeout' : 'unreachable';
  }
  agentCache = { at: now, value };
  return value;
}

let asksThisMinute = [];
async function askAgent(topic, question) {
  const now = Date.now();
  asksThisMinute = asksThisMinute.filter(t => now - t < 60000);
  if (asksThisMinute.length >= MAX_ASK) return { ok: false, why: 'rate', note: `more than ${MAX_ASK} asks a minute` };
  const key = readKey();
  if (!key) return { ok: false, why: 'no_key', note: `${KEY_NAME} is not in ${ENV_FILE}` };
  const alive = await probeAgent(true);
  if (!alive.alive) return { ok: false, why: alive.why || 'agent_down', note: `no agent on ${GATEWAY}` };

  const lines = [
    'You are answering from the Hydra Monitor board, on the node that raised the door.',
    'One topic from the train of thought follows. Answer the question about it briefly and concretely -',
    'a short paragraph, no preamble, no restating the question.',
    '',
    `TOPIC ${topic.ref} - ${topic.title}`,
    `state: ${topic.state}${topic.tags.length ? ' | tags: ' + topic.tags.join(', ') : ''}`,
    topic.intent ? `intent: ${topic.intent}` : '',
    topic.questions.length ? 'unanswered:\n' + topic.questions.slice(0, 6).map(q => '  - ' + q).join('\n') : '',
    topic.messages.length ? 'latest trail:\n' + topic.messages.map(m => `  [${m.kind}] ${m.text.slice(0, 400)}`).join('\n') : ''
  ].filter(Boolean);

  asksThisMinute.push(now);
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ASK_TIMEOUT_MS);
  try {
    const res = await fetch(GATEWAY + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: 'hermes-agent',
        messages: [
          { role: 'system', content: lines.join('\n') },
          { role: 'user', content: question || 'What is the next concrete step here, and what would prove it?' }
        ],
        stream: false
      }),
      signal: ac.signal
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, why: 'gateway_' + res.status, note: (await res.text()).slice(0, 300), ms: Date.now() - t0 };
    const j = await res.json();
    const answer = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    return { ok: true, ref: topic.ref, answer, ms: Date.now() - t0, usage: j.usage || null };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, why: e.name === 'AbortError' ? 'timeout' : 'error', note: e.message, ms: Date.now() - t0 };
  }
}

// ---------------------------------------------------------------- http
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

function sendJson(res, code, body) {
  const text = JSON.stringify(body, null, 1);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > 64 * 1024) throw new Error('too_big'); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (p === '/health') {
    const a = await probeAgent(false);
    return sendJson(res, 200, {
      ok: true, door: 'monitor', port: PORT, thoughts: THOUGHTS,
      agent: { alive: a.alive, door: a.door, key: a.key, why: a.why || null }
    });
  }

  if (p === '/api/topics') {
    const t = readTopics();
    if (!t.ok) return sendJson(res, 503, t); // a board that cannot read its input must refuse, not show an empty LAN
    return sendJson(res, 200, t);
  }

  if (p === '/api/agent') return sendJson(res, 200, await probeAgent(false));

  if (p === '/api/ask' && req.method === 'POST') {
    let b;
    try { b = await body(req); } catch { return sendJson(res, 413, { ok: false, why: 'too_big' }); }
    const doc = readTopics();
    if (!doc.ok) return sendJson(res, 503, doc);
    const topic = doc.topics.find(t => t.ref === b.ref);
    if (!topic) return sendJson(res, 404, { ok: false, why: 'no_such_topic', ref: b.ref, candidates: doc.topics.slice(0, 5).map(t => t.ref) });
    const out = await askAgent(topic, typeof b.question === 'string' ? b.question.slice(0, 2000) : '');
    return sendJson(res, out.ok ? 200 : 502, out);
  }

  // static
  let file = p === '/' ? '/public/index.html' : p;
  const full = path.join(ROOT, decodeURIComponent(file));
  if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end('no'); }
  try {
    const buf = fs.readFileSync(full);
    res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream', 'cache-control': 'no-store' });
    return res.end(buf);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found: ' + p);
  }
});

server.on('error', (e) => {
  console.error(`monitor cannot serve on :${PORT} - ${e.code || e.message}`);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  const t = readTopics();
  console.log(`monitor :${PORT} on ${HOST} - ${t.ok ? t.topics.length + ' topics from ' + THOUGHTS : 'THOUGHTS UNREADABLE: ' + THOUGHTS}`);
  console.log(`agent door ${GATEWAY} (key from ${KEY_NAME} in ${ENV_FILE}, read per call)`);
});
