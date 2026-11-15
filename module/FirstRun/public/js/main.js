#!/usr/bin/env node
/**
 * FirstRun - the door a bare machine is introduced through.
 *
 * The operator's model (2026-11-15), in their words: "Hydra first tries to install Hermes ... have your own agent
 * installing? Ok that is Echidna! No agent? Hermes!" and "Birth Ritual -- not really a ritual -- but Phoenix cycle will
 * include a personality file -- If the user has their own agent -- It can just say -- oh... This hydra thing calls me
 * Echidna... so you know...".
 *
 * So this module answers four questions and never invents a fifth:
 *
 *   GET  /api/scan         what is on this box: agents already installed, brains that could answer, hardware, whether
 *                          a node.json already exists (an already-born node is not re-born by accident)
 *   GET  /api/plan         the service library, each entry marked fits / does-not-fit against THIS machine's measured
 *                          cores, RAM, GPU and free disk - "mostly not enough resources" as a list, not a guess
 *   POST /api/probe-brain  one real call to a candidate brain before it is trusted; a probe that cannot answer is a
 *                          candidate that is not chosen
 *   POST /api/birth        write node.json, personality.json and the brain choice, then (optionally) start the doors in
 *                          order through ProcessWrapper so every one of them is a row a person can see and close
 *
 * An agent that already exists is ADOPTED: nothing is installed, and the personality file is what tells it that in Hydra
 * its name is Echidna. Only a machine with no agent gets Hermes installed.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import net from 'node:net';

const argOf = (name, fallback = null) => {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

// .../module/FirstRun/public/js/main.js -> .../module/FirstRun, and one further up is the Hydra root that holds
// `library/` and `module/`. Getting these two mixed up is how a personality file once landed in the wrong folder.
const MODULE_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const HYDRA_ROOT = path.resolve(MODULE_DIR, '..', '..');
// FIRST_RUN_ROOT rehearses a whole birth in a sandbox: rewriting this node's node.json to prove a code path would be
// a very expensive test. It names the HYDRA root, not the module.
const ROOT = process.env.FIRST_RUN_ROOT ? path.resolve(process.env.FIRST_RUN_ROOT) : HYDRA_ROOT;
const DATA = path.join(MODULE_DIR, 'data');
const PORT = Number(argOf('port', 8166));
const HOST = argOf('host', '0.0.0.0');
const PW = argOf('pw', 'http://127.0.0.1:8125');
const RM = argOf('rm', 'http://127.0.0.1:8129');
const STATE = argOf('state', 'http://127.0.0.1:8127');

// On Windows 'where hermes' and 'hermes --version' both go through a .cmd shim, and execFile without a shell answers
// EINVAL for a shim. `where.exe` is a real binary; a version probe needs the shell, with the path quoted.
const run = (file, args, timeoutMs = 8000, useShell = false) => new Promise((resolve) => {
  execFile(file, args, { windowsHide: true, timeout: timeoutMs, shell: useShell }, (err, stdout) =>
    resolve({ ok: !err, out: String(stdout || '').trim(), error: err ? err.message : null }));
});
const json = (res, code, body) => {
  const text = JSON.stringify(body, null, 1);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
};
const readBody = (req) => new Promise((resolve) => {
  let raw = '';
  req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
  req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
});
const readJson = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 1));
};

/** The agents a person might already be running. Order matters: the one Hydra ships is last, because adopting is free. */
const AGENT_CANDIDATES = [
  { id: 'hermes',   label: 'Hermes',        bin: 'hermes', note: 'the agent Hydra is built around' },
  { id: 'claude',   label: 'Claude Code',   bin: 'claude', note: 'adopted as Echidna; nothing installed' },
  { id: 'codex',    label: 'Codex',         bin: 'codex',  note: 'adopted as Echidna; nothing installed' },
  { id: 'aider',    label: 'Aider',         bin: 'aider',  note: 'adopted as Echidna; nothing installed' },
  { id: 'gemini',   label: 'Gemini CLI',    bin: 'gemini', note: 'adopted as Echidna; nothing installed' },
];

async function scanAgents() {
  const found = [];
  for (const a of AGENT_CANDIDATES) {
    const where = await run('where.exe', [a.bin], 4000);
    if (where.ok && where.out) {
      const binary = where.out.split(/\r?\n/)[0].trim();
      let version = null;
      const v = await run(`"${binary}"`, ['--version'], 8000, true);
      if (v.ok && v.out) version = v.out.split(/\r?\n/)[0].slice(0, 90);
      found.push({ ...a, binary, version });
    }
  }
  return found;
}

/** Hardware, preferring the Resource Manager's measurement (it already resolves VRAM from the registry) over a guess. */
async function hardware() {
  let rm = null;
  try {
    const res = await fetch(`${RM}/api/inventory`, { signal: AbortSignal.timeout(4000) });
    if (res.ok) { const body = await res.json(); rm = body.inventory ?? null; }
  } catch { /* RM not up yet: a fresh box has no doors, and that is not an error */ }
  const gpus = rm?.gpus?.length ? rm.gpus : [];
  const totalRamMb = rm?.mem?.totalMb ?? Math.round(os.totalmem() / 1048576);
  const freeDiskGb = rm?.disks?.length
    ? Math.max(...rm.disks.map((d) => (d.freeMb ?? 0) / 1024))
    : null;
  return {
    host: os.hostname(), platform: process.platform, arch: process.arch,
    cores: rm?.cpu?.cores ?? os.cpus().length,
    ramMb: totalRamMb,
    freeDiskGb: freeDiskGb && Math.round(freeDiskGb * 10) / 10,
    gpus: gpus.map((g) => ({ name: g.name, vramMb: g.memTotalMb ?? null })),
    source: rm ? 'ResourceManager' : 'os',
  };
}

/** Every service the library offers, marked against this machine. The library is the catalogue; this is the fit. */
function servicePlan(hw) {
  const libDir = path.join(ROOT, 'library');
  const rows = [];
  let names = [];
  try { names = fs.readdirSync(libDir).filter((n) => fs.statSync(path.join(libDir, n)).isDirectory()); } catch { return { ok: false, error: `no library at ${libDir}` }; }
  for (const name of names) {
    const file = path.join(libDir, name, 'service.json');
    if (!fs.existsSync(file)) continue;
    const svc = readJson(file, {});
    const needs = svc.needs ?? {};
    const reasons = [];
    let fits = true;
    if (needs.gpu && !hw.gpus.length) { fits = false; reasons.push('needs a GPU'); }
    if (needs.vramGb && hw.gpus.length) {
      const needMb = Number(needs.vramGb) * 1024;
      const haveMb = Math.max(...hw.gpus.map((g) => g.vramMb ?? 0));
      // compare in MB with 256 MB of slack: a "16 GB" card reports 16368 MB, and 15.98 < 16 is not a real shortage
      if (haveMb + 256 < needMb) { fits = false; reasons.push(`needs ${needMb} MB VRAM, has ${haveMb} MB`); }
    }
    if (needs.ramMb && hw.ramMb < Number(needs.ramMb)) { fits = false; reasons.push(`needs ${needs.ramMb} MB RAM, has ${hw.ramMb}`); }
    if (needs.cores && hw.cores < Number(needs.cores)) { fits = false; reasons.push(`needs ${needs.cores} cores, has ${hw.cores}`); }
    if (needs.diskGb && hw.freeDiskGb !== null && hw.freeDiskGb < Number(needs.diskGb)) { fits = false; reasons.push(`needs ${needs.diskGb} GB free, has ${hw.freeDiskGb}`); }
    rows.push({
      id: name, title: svc.advert?.what ? String(svc.advert.what).slice(0, 160) : name,
      karma: svc.advert?.karma ?? null, needs, fits, reasons,
      whenItDoesNotFit: svc.whenItDoesNotFit ?? null,
      tasks: svc.tasks ?? (svc.task ? [svc.task] : []),
    });
  }
  rows.sort((a, b) => Number(b.fits) - Number(a.fits) || a.id.localeCompare(b.id));
  return { ok: true, at: new Date().toISOString(), host: hw.host, hardware: hw,
           fits: rows.filter((r) => r.fits).length, blocked: rows.filter((r) => !r.fits).length, services: rows };
}

/**
 * Brains, in the order the operator listed them: a free OpenRouter model first, then a paid key, then a local server.
 * A candidate is never "chosen" until one real call comes back - the probe is the point, not a formality.
 */
async function brains() {
  const env = process.env;
  const saved = readJson(path.join(DATA, 'brain.json'), {}) ?? {};
  const candidates = [
    { id: 'openrouter-free', label: 'OpenRouter (free models)', kind: 'openrouter', needs: 'OPENROUTER_API_KEY',
      hasKey: Boolean(env.OPENROUTER_API_KEY || saved?.openrouter?.key), base: 'https://openrouter.ai/api/v1' },
    { id: 'deepseek', label: 'DeepSeek', kind: 'deepseek', needs: 'DEEPSEEK_API_KEY',
      hasKey: Boolean(env.DEEPSEEK_API_KEY || saved?.deepseek?.key), base: 'https://api.deepseek.com/v1' },
    { id: 'local', label: 'llama.cpp on this node', kind: 'local', needs: 'a server on :8080', base: 'http://127.0.0.1:8080/v1' },
  ];
  return { saved: saved.chosen ?? null, candidates };
}

async function probeBrain(body) {
  const id = String(body.id ?? '');
  const key = body.key || process.env.OPENROUTER_API_KEY || process.env.DEEPSEEK_API_KEY || null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20000);
  const started = Date.now();
  try {
    if (id === 'openrouter-free') {
      const list = await fetch('https://openrouter.ai/api/v1/models', { signal: ac.signal });
      if (!list.ok) return { ok: false, id, ms: Date.now() - started, error: `models list HTTP ${list.status}` };
      const data = await list.json();
      const free = (data.data ?? []).filter((m) => String(m?.pricing?.prompt ?? '1') === '0' && String(m?.pricing?.completion ?? '1') === '0');
      if (!key) {
        return { ok: false, id, ms: Date.now() - started, reachable: true, freeModels: free.length,
                 error: 'no key: set OPENROUTER_API_KEY (a free model still needs an account key)',
                 exampleModels: free.slice(0, 3).map((m) => m.id) };
      }
      const model = body.model || free[0]?.id;
      const chat = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Say the single word: ready' }], max_tokens: 8 }),
        signal: ac.signal,
      });
      const text = await chat.text();
      return { ok: chat.ok, id, model, ms: Date.now() - started, status: chat.status, answer: text.slice(0, 200) };
    }
    if (id === 'deepseek') {
      if (!key) return { ok: false, id, error: 'no key: set DEEPSEEK_API_KEY' };
      const chat = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: body.model || 'deepseek-chat', messages: [{ role: 'user', content: 'Say: ready' }], max_tokens: 8 }),
        signal: ac.signal,
      });
      const text = await chat.text();
      return { ok: chat.ok, id, ms: Date.now() - started, status: chat.status, answer: text.slice(0, 200) };
    }
    if (id === 'local') {
      const res = await fetch(`${body.base || 'http://127.0.0.1:8080/v1'}/models`, { signal: ac.signal });
      const data = res.ok ? await res.json() : null;
      return { ok: res.ok, id, ms: Date.now() - started, status: res.status,
               models: (data?.data ?? []).map((m) => m.id).slice(0, 5) };
    }
    return { ok: false, id, error: 'unknown brain id' };
  } catch (error) {
    return { ok: false, id, ms: Date.now() - started, error: error.name === 'AbortError' ? 'no answer in 20 s' : error.message };
  } finally { clearTimeout(timer); }
}

const DEFAULT_PERSONALITY = {
  name: 'Echidna',
  aliases: ['echidna', 'the agent'],
  role: 'the agent of this node: the one that speaks, remembers and acts',
  voice: { character: 'destiny', speed: 1.04, fallback: 'sapi' },
  tone: 'plain, direct, no flattery. Answer the question that was asked, say plainly when something is unknown.',
  traits: ['says what it knows and what it does not', 'prefers evidence over adjectives', 'never invents a result'],
  addresses_operator_as: 'you',
  note: 'A user who already has their own agent does not get a new one: Hydra adopts it, and this file is what tells it that here its name is Echidna.',
};

async function birth(body) {
  const hw = await hardware();
  const agents = await scanAgents();
  const choice = body.agent ?? (agents[0] ? { id: agents[0].id, binary: agents[0].binary, version: agents[0].version } : null);
  if (!choice) {
    return { ok: false, error: 'no agent on this box: install Hermes first, then run the birth again',
             how: 'winget install NousResearch.Hermes  (or the installer the operator prefers)', scannedFor: AGENT_CANDIDATES.map((a) => a.bin) };
  }
  const rp = stripTrailingSlash;
  const stateUrl = rp(body.stateUrl || STATE);
  // an existing node.json means this node was already born: refusing is the only honest answer to a re-run
  const menuNode = path.join(ROOT, 'module', 'Menu', 'data', 'node.json');
  const coreNode = path.join(ROOT, 'module', 'Core', 'data', 'node.json');
  const existing = readJson(menuNode, null) ?? readJson(coreNode, null);
  if (existing && !body.force) {
    return { ok: false, error: 'this node already has a node.json - not re-born', node: { ref: existing.ref, name: existing.name }, how: 'pass {"force": true} to rewrite it' };
  }
  const ref = String(body.ref || existing?.ref || os.hostname().replace(/[^a-zA-Z0-9._-]/g, '') || 'node').toLowerCase();
  const name = String(body.name || existing?.name || os.hostname());

  const node = {
    ref, name,
    bornAt: new Date().toISOString(),
    host: hw.host,
    hardware: { cores: hw.cores, ramMb: hw.ramMb, gpus: hw.gpus, freeDiskGb: hw.freeDiskGb },
    agent: { id: choice.id, binary: choice.binary, version: choice.version ?? null, installed: choice.id === 'hermes' ? 'present' : 'adopted' },
    // the operator's rule: mining only after the card has been quiet for 30 minutes
    standby: { after: 1800, label: 'idle mining (30 min of quiet)' },
  };
  if (!existing || body.force) {
    writeJson(menuNode, { ...existing, ...node });
    if (fs.existsSync(path.dirname(coreNode))) writeJson(coreNode, { ...(readJson(coreNode, {}) ?? {}), ...node });
  }

  // personality is data, not code: Phoenix and the agent both read this file
  const personalityFile = path.join(ROOT, 'module', 'Phoenix', 'data', 'personality.json');
  const personality = readJson(personalityFile, null) ?? { ...DEFAULT_PERSONALITY, createdAt: new Date().toISOString() };
  if (!readJson(personalityFile, null)) writeJson(personalityFile, personality);

  const plan = {
    version: 1, at: new Date().toISOString(), ref, name, hardware: hw, agent: choice,
    personality: { file: personalityFile, name: personality.name },
    doors: body.doors ?? [],
    stateUrl,
  };
  writeJson(path.join(DATA, 'plan.json'), plan);
  // The half of a birth that is not paperwork: the doors. Only when asked (start), and only in declared order, through
  // ProcessWrapper - a node that comes up in a way nobody can see is not a node, it is a mystery.
  const brought = body.start ? await bringUp({ ports: Array.isArray(body.ports) ? body.ports.map(Number) : null }) : null;
  if (brought) { plan.brought = brought; writeJson(path.join(DATA, 'plan.json'), plan); }

  return { ok: true, born: { ref, name }, agent: choice, personality: personalityFile, nodeFile: menuNode,
           brought: brought ? { started: brought.started, skipped: brought.skipped, failed: brought.failed, results: brought.results.map((r) => ({ name: r.name, port: r.port, action: r.action })) } : null,
           plan: path.join(DATA, 'plan.json'), next: [
             `GET ${RM}/api/inventory  - prove the hardware numbers we just wrote`,
             `POST /api/plan           - which library services fit this box`,
             `Phoenix: publish node.${ref}.personality, then let the cycle carry it` ] };
}


/**
 * Doors: what a fresh node is made of.
 *
 * Every module that serves something already declares it in its own join.json (`port`, `start`). Reading those files is
 * better than a boot list in code, because a module that adds itself adds its door. The ORDER, though, is not derivable:
 * ProcessWrapper must exist before anything it launches, and State must exist before the doors that publish into it. So
 * the order lives in data/doors.json where a person can see and change it.
 */
const BOOT_ORDER_FILE = () => path.join(DATA, 'doors.json');
const DEFAULT_BOOT_ORDER = [8125, 8127, 8131, 8133, 8135, 8129];

function expandVars(text) {
  return String(text).replace(/%([A-Za-z_]+)%/g, (m, name) => process.env[name] ?? m);
}

/** Split a `start` line into a command and its arguments, honouring a quoted command with spaces in it. */
function parseStart(start) {
  const text = expandVars(String(start ?? '').trim());
  if (!text) return null;
  if (text.startsWith('"')) {
    const end = text.indexOf('"', 1);
    if (end > 0) return { command: text.slice(1, end), args: text.slice(end + 1).trim().split(/\s+/).filter(Boolean) };
  }
  const parts = text.split(/\s+/);
  return { command: parts[0], args: parts.slice(1) };
}

const normKey = (t) => String(t ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Ask the door who it is. A port that answers with another module's name is occupied, not available. */
async function doorIdentity(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return { answered: true, name: null, status: res.status };
    const body = await res.json().catch(() => ({}));
    return { answered: true, name: body.module ?? body.door ?? body.name ?? null, status: res.status, body };
  } catch {
    return { answered: false, name: null, status: null };
  }
}

/** Is anything listening on this port on loopback? A door that answers is not started twice. */
async function isListening(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (value) => { try { socket.destroy(); } catch { } resolve(value); };
    socket.setTimeout(1200);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, '127.0.0.1');
  });
}
/** Every door the module tree declares, with whether it is already listening. */
async function doors() {
  const moduleDir = path.join(ROOT, 'module');
  const found = [];
  let names = [];
  try { names = fs.readdirSync(moduleDir); } catch { return { ok: false, error: `no module dir at ${moduleDir}`, doors: [] }; }
  for (const name of names) {
    const joinFile = path.join(moduleDir, name, 'join.json');
    if (!fs.existsSync(joinFile)) continue;
    const join = readJson(joinFile, null);
    if (!join || !join.port) continue;
    const parsed = parseStart(join.start);
    if (!parsed) continue;
    // a join.json whose path was written with a single backslash before "node" contains real newlines; spawning it can
    // only fail, so it is reported as malformed here instead of becoming a mystery crash in ProcessWrapper
    const malformed = /[\r\n]/.test(parsed.command) ? 'start line contains newlines - the path in join.json is mis-escaped'
                    : parsed.command.includes('"') ? 'start line has an unbalanced quote'
                    : null;
    const port = Number(join.port);
    const listening = await isListening(port);
    let occupiedBy = null;
    let unverified = false;
    if (listening) {
      const id = await doorIdentity(port);
      // punctuation-blind, because a module calls itself "TrainOfThought" while its row is "trainofthought-8135"
      if (id.answered && id.name && !normKey(id.name).startsWith(normKey(name)) && !normKey(name).startsWith(normKey(id.name))) {
        occupiedBy = String(id.name);
      } else if (id.answered && !id.name) {
        // A door that answers without naming itself cannot prove it is this module (Basic_App, the cycle doors). That is
        // not a collision - the port is answering and stopping it would be worse - it is an UNVERIFIED door, carried as a
        // flag so nobody reads "up" as "proven".
        unverified = true;
      }
    }
    found.push({
      module: name, name: `${name.toLowerCase()}-${join.port}`, port,
      command: parsed.command, args: parsed.args, cwd: path.join(moduleDir, name),
      what: join.what ?? null, malformed, listening,
      mine: listening && !occupiedBy,   // the port answers AND the answer says it is this module
      verified: listening && !occupiedBy && !unverified,
      occupiedBy, unverified,
    });
  }
  // Two modules declaring the same port is a real collision: whichever starts second dies, and the survivor answers for
  // the wrong name. It is reported, never resolved silently - the port is somebody's decision.
  const byPort = new Map();
  for (const d of found) {
    if (!byPort.has(d.port)) byPort.set(d.port, []);
    byPort.get(d.port).push(d.module);
  }
  const collisions = [...byPort.entries()].filter(([, mods]) => mods.length > 1)
    .map(([port, mods]) => ({ port, modules: mods, listening: found.find((d) => d.port === port)?.listening ?? false }));
  const order = readJson(BOOT_ORDER_FILE(), null)?.order ?? DEFAULT_BOOT_ORDER;
  found.sort((a, b) => {
    const ai = order.indexOf(a.port), bi = order.indexOf(b.port);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi) || a.port - b.port;
  });
  return { ok: true, at: new Date().toISOString(), order, count: found.length,
           up: found.filter((d) => d.mine).length, verified: found.filter((d) => d.verified).length,
           occupied: found.filter((d) => d.occupiedBy).length, unverified: found.filter((d) => d.unverified).length,
           malformed: found.filter((d) => d.malformed).length, collisions, doors: found };
}

/** Start one door through ProcessWrapper, so it is a row a person can see and close. */
async function startDoor(door) {
  const res = await fetch(`${PW}/api/processes`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: door.name, command: door.command, args: door.args, cwd: door.cwd }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => ({}));
  const row = body.process ?? body;
  return { ...door, started: res.ok, life: row.life ?? null, error: row.error ?? (res.ok ? null : `HTTP ${res.status}`),
           id: row.id ?? null };
}

/**
 * Bring a node up in dependency order. Anything already listening is skipped - a door that answers is not restarted,
 * because restarting a live State door costs every publisher its entries for a cycle.
 */
async function bringUp({ ports = null, dryRun = false } = {}) {
  const d = await doors();
  if (!d.ok) return d;
  const wanted = ports && ports.length ? d.doors.filter((x) => ports.includes(x.port)) : d.doors.filter((x) => d.order.includes(x.port));
  const results = [];
  for (const door of wanted) {
    if (door.mine) { results.push({ ...door, action: 'already-listening' }); continue; }
    if (door.occupiedBy) { results.push({ ...door, action: 'refused-port-occupied', error: `port ${door.port} answers as ${door.occupiedBy}` }); continue; }
    if (door.malformed) { results.push({ ...door, action: 'refused-malformed', error: door.malformed }); continue; }
    if (dryRun) { results.push({ ...door, action: 'would-start' }); continue; }
    const out = await startDoor(door);
    let up = false;
    for (let i = 0; i < 12 && !up; i++) { if (await isListening(door.port)) up = true; else await new Promise((r) => setTimeout(r, 400)); }
    results.push({ ...out, action: out.started ? (up ? 'started' : 'started-not-answering') : 'failed' });
  }
  return { ok: results.every((r) => r.action !== 'failed'), at: new Date().toISOString(), results,
           started: results.filter((r) => r.action === 'started').length,
           skipped: results.filter((r) => r.action === 'already-listening').length,
           failed: results.filter((r) => r.action === 'failed').length };
}

const stripTrailingSlash = (s) => String(s).replace(/\/$/, '');

async function route(req, res) {
  const url = new URL(req.url ?? '/', `http://${HOST}`);
  const p = url.pathname;
  const method = req.method ?? 'GET';
  if (p === '/health') {
    return json(res, 200, { ok: true, door: 'first-run', host: os.hostname(), port: PORT, pw: PW, rm: RM, state: STATE });
  }
  if (p === '/api/scan' && method === 'GET') {
    const hw = await hardware();
    const agents = await scanAgents();
    const menuNode = path.join(ROOT, 'module', 'Menu', 'data', 'node.json');
    const existing = readJson(menuNode, null);
    return json(res, 200, {
      ok: true, at: new Date().toISOString(), host: hw.host, hardware: hw,
      agents, agentChosen: agents.length ? agents[0] : null,
      verdict: existing ? { state: 'already-born', ref: existing.ref, name: existing.name, bornAt: existing.bornAt ?? null }
                        : agents.length ? { state: 'ready', why: `adopt ${agents[0].label} - nothing to install`, as: 'Echidna' }
                                        : { state: 'needs-agent', why: 'no agent on this box: install Hermes, then birth again' },
      brain: await brains(),
      personality: readJson(path.join(ROOT, 'module', 'Phoenix', 'data', 'personality.json'), null) ? 'present' : 'will be created',
    });
  }
  if (p === '/api/plan' && method === 'GET') {
    const hw = await hardware();
    return json(res, 200, servicePlan(hw));
  }
  if (p === '/api/brains' && method === 'GET') return json(res, 200, { ok: true, ...(await brains()) });

  // doors: what this node is made of, and the way to bring them up through ProcessWrapper in dependency order
  if (p === '/api/doors' && method === 'GET') return json(res, 200, await doors());
  if (p === '/api/doors/start' && method === 'POST') {
    const body = await readBody(req);
    const out = await bringUp({ ports: Array.isArray(body.ports) ? body.ports.map(Number) : null, dryRun: Boolean(body.dryRun) });
    return json(res, out.ok ? 200 : 500, out);
  }

  // The personality is the one thing an already-born node may still need (Phoenix carries it, Echidna speaks it), so it
  // has its own door: reading it, writing it, and publishing it to State where the rest of the tree can see the name.
  if (p === '/api/personality' && method === 'GET') {
    const file = path.join(ROOT, 'module', 'Phoenix', 'data', 'personality.json');
    const cur = readJson(file, null);
    return json(res, cur ? 200 : 404, { ok: Boolean(cur), file, personality: cur });
  }
  if (p === '/api/personality' && method === 'POST') {
    const body = await readBody(req);
    const file = path.join(ROOT, 'module', 'Phoenix', 'data', 'personality.json');
    const cur = readJson(file, null) ?? { ...DEFAULT_PERSONALITY, createdAt: new Date().toISOString() };
    const next = { ...cur, ...body, updatedAt: new Date().toISOString() };
    writeJson(file, next);
    const ref = readJson(path.join(ROOT, 'module', 'Menu', 'data', 'node.json'), null)?.ref ?? null;
    let published = null;
    if (ref) {
      try {
        const res2 = await fetch(`${stripTrailingSlash(STATE)}/api/state/register`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: `node.${ref}.personality`, content: next }), signal: AbortSignal.timeout(2000),
        });
        published = res2.status;
      } catch (error) { published = `failed: ${error.message}`; }
    }
    return json(res, 200, { ok: true, file, personality: next, publishedTo: ref ? `node.${ref}.personality` : null, published });
  }
  if (p === '/api/probe-brain' && method === 'POST') {
    const body = await readBody(req);
    const result = await probeBrain(body);
    if (result.ok && body.remember) writeJson(path.join(DATA, 'brain.json'), { chosen: body, verifiedAt: new Date().toISOString(), probe: result });
    return json(res, result.ok ? 200 : 400, result);
  }
  if (p === '/api/birth' && method === 'POST') {
    const body = await readBody(req);
    const result = await birth(body);
    return json(res, result.ok ? 200 : 409, result);
  }
  return json(res, 404, { ok: false, error: 'no such route', path: p,
    routes: ['GET /health', 'GET /api/scan', 'GET /api/plan', 'GET /api/brains', 'POST /api/probe-brain', 'POST /api/birth'] });
}

const server = http.createServer((req, res) => { route(req, res).catch((e) => json(res, 500, { ok: false, error: e.message })); });
server.listen(PORT, HOST, () => {
  console.log(`first-run - http://${HOST}:${PORT}  (GET /api/scan to see what this box already is)`);
});
