// Monitor :8157 - the board you can read, and the agent you can reach.
//
// What it does:
//   GET  /                 the slideshow page (one slide per Train of Thought topic)
//   GET  /api/topics       every topic: title, state, intent, unanswered questions, key messages
//   GET  /api/agent        is there an agent to click into? (Tell Mom 8139 -> Echidna 8138)
//   POST /api/ask          {"ref":"...","question":"..."} -> a Tell Mom tell, inserted into Echidna's agent
//                          session, and that agent's answer returned to the page
//
// The click path IS the Tell Mom protocol, not a private call:
//   1. POST 8139 /api/tell {severity, subject, body, wants, dedupeKey, channels:["pane","discord"]}
//        - the pane channel inserts a note turn into Echidna's thread; Discord tells the phone
//   2. POST 8138 /api/say {text}
//        - Echidna runs the agent ASSIGNED TO IT, continuing its own session id, so the reply is a turn in the
//          same conversation the pane shows - the v1 behaviour, not a stateless one-off completion.
//
// Two rules this door keeps:
//   - A click never goes to a dead link: both doors are probed, and the button names why it cannot when they are down.
//   - No credential lives here: Tell Mom and Echidna own their own keys, this door holds none.
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
const TELLMOM = argOf('tellmom', 'http://127.0.0.1:8139');
const ECHIDNA = argOf('echidna', 'http://127.0.0.1:8138');
const ASK_TIMEOUT_MS = Number(argOf('ask-timeout', 300000));
const MAX_ASK = 40; // a board is not a chat app; forty asks a minute is plenty

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

// ---------------------------------------------------------------- the two doors
async function getJson(url, timeoutMs, opts) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...(opts || {}), signal: ac.signal });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text.slice(0, 400) }; }
    return { status: res.status, ok: res.ok, body: parsed };
  } catch (e) {
    return { status: 0, ok: false, body: null, error: e.name === 'AbortError' ? 'timeout' : 'unreachable' };
  } finally { clearTimeout(timer); }
}

let doorCache = { at: 0, value: null };

async function probeDoors(force) {
  const now = Date.now();
  if (!force && doorCache.value && now - doorCache.at < 5000) return doorCache.value;
  const [tm, ec] = await Promise.all([
    getJson(TELLMOM + '/api/channels', 2500),
    getJson(ECHIDNA + '/health', 2500)
  ]);
  const channels = (tm.body && tm.body.channels) || null;
  const pane = channels && channels.pane ? channels.pane : null;
  const discord = channels && channels.discord ? channels.discord : null;
  const value = {
    ok: tm.ok && ec.ok && !!(pane && pane.ok),
    tellmom: { ok: tm.ok, door: TELLMOM, why: tm.ok ? null : (tm.error || 'http_' + tm.status), channels: channels ? Object.keys(channels) : [] },
    echidna: {
      ok: ec.ok, door: ECHIDNA, why: ec.ok ? null : (ec.error || 'http_' + ec.status),
      session: (ec.body && (ec.body.session || ec.body.sessionId)) || null
    },
    pane: pane ? { ok: !!pane.ok, detail: pane.detail || null } : { ok: false, detail: 'no pane channel configured' },
    discord: discord ? { ok: !!discord.ok, detail: discord.detail || null } : null,
    alive: !!(pane && pane.ok && ec.ok),
    why: tm.ok ? (ec.ok ? (pane && pane.ok ? null : 'no_pane') : 'echidna_down') : 'tellmom_down'
  };
  doorCache = { at: now, value };
  return value;
}

let asksThisMinute = [];
function rateOk() {
  const now = Date.now();
  asksThisMinute = asksThisMinute.filter(t => now - t < 60000);
  if (asksThisMinute.length >= MAX_ASK) return false;
  asksThisMinute.push(now);
  return true;
}

function briefFor(topic, question) {
  const lines = [
    `Monitor board · topic ${topic.ref} · ${topic.title}`,
    `state: ${topic.state}${topic.tags.length ? ' | tags: ' + topic.tags.join(', ') : ''}`,
    topic.intent ? `intent: ${topic.intent}` : '',
    topic.questions.length ? 'unanswered:\n' + topic.questions.slice(0, 6).map(q => '  - ' + q).join('\n') : '',
    topic.messages.length ? 'latest trail:\n' + topic.messages.map(m => `  [${m.kind}] ${m.text.slice(0, 400)}`).join('\n') : '',
    '',
    question || 'What is the next concrete step here, and what would prove it?'
  ].filter(Boolean);
  return lines.join('\n');
}

async function askAgent(topic, question) {
  if (!rateOk()) return { ok: false, why: 'rate', note: `more than ${MAX_ASK} asks a minute` };
  const doors = await probeDoors(true);
  if (!doors.echidna.ok) {
    return { ok: false, why: 'echidna_down', note: `no Echidna on ${ECHIDNA} - the agent assigned to it cannot be reached` };
  }
  const text = briefFor(topic, question);

  // 1. the Tell Mom protocol: one verb, several transports. The pane channel is what puts it into the session.
  const tell = await getJson(TELLMOM + '/api/tell', 20000, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      severity: 'note',
      subject: `Monitor · ${topic.title}`.slice(0, 120),
      body: text.slice(0, 4000),
      wants: 'answer',
      dedupeKey: `monitor:${topic.ref}`,
      channels: ['pane', 'discord']
    })
  });

  // 2. Echidna's own agent, continuing its own session - the v1 behaviour
  const t0 = Date.now();
  const say = await getJson(ECHIDNA + '/api/say', ASK_TIMEOUT_MS, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text })
  });
  const ms = Date.now() - t0;

  const turns = (say.body && say.body.turns) || [];
  const reply = turns.find(t => t && (t.role === 'echidna' || t.role === 'system')) || turns[turns.length - 1] || null;

  return {
    ok: !!(say.body && say.body.ok),
    ref: topic.ref,
    ms,
    sessionId: (reply && reply.sessionId) || doors.echidna.session || null,
    answer: (reply && reply.text) || '',
    told: {
      ok: !!(tell.body && tell.body.ok),
      why: tell.body ? (tell.body.muted ? 'muted' : (tell.body.ok ? null : (tell.body.error || 'refused'))) : (tell.error || 'http_' + tell.status),
      status: tell.status,
      result: tell.body ? (tell.body.told || tell.body.results || tell.body.channels || null) : null
    },
    why: (say.body && say.body.ok) ? null : (say.status === 409 ? 'busy' : (say.error || 'http_' + say.status)),
    note: (say.body && say.body.error) || ''
  };
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
    const d = await probeDoors(false);
    return sendJson(res, 200, {
      ok: true, door: 'monitor', port: PORT, thoughts: THOUGHTS,
      agent: { alive: d.alive, why: d.why || null, tellmom: d.tellmom, echidna: d.echidna, pane: d.pane, discord: d.discord },
      path: 'tell mom -> echidna agent'
    });
  }

  if (p === '/api/topics') {
    const t = readTopics();
    if (!t.ok) return sendJson(res, 503, t); // a board that cannot read its input must refuse, not show an empty LAN
    return sendJson(res, 200, t);
  }

  if (p === '/api/agent') {
    const d = await probeDoors(false);
    return sendJson(res, 200, {
      ok: d.ok, alive: d.alive, why: d.why || null,
      door: ECHIDNA, protocol: 'tell mom', tellmom: d.tellmom, echidna: d.echidna,
      pane: d.pane, discord: d.discord, session: d.echidna.session
    });
  }

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
  console.log(`click path: ${TELLMOM} /api/tell -> ${ECHIDNA} /api/say (the agent assigned to Echidna, its own session)`);
});
