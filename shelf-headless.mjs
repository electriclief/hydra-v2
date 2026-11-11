/**
 * shelf-headless.mjs — the shelf as a SERVICE, with no Electron in the path.
 *
 * Why this exists: main.cjs --headless boots the same stack, but it is an Electron app, and Electron as a
 * scheduled SYSTEM task in session 0 is fragile (a single-instance lock with no window, no desktop for the
 * GPU process, exit code 1 with nothing in the log). The doors and Basic_App are plain Node; only the WINDOW
 * needs Electron. So the service path is Node only, and the window attaches to it as a viewer.
 *
 * Same contract as main.cjs ensureDoors():
 *   1. ProcessWrapper hidden (or adopted if it is already answering)
 *   2. every other door launched THROUGH ProcessWrapper, so its console is a tab in the window
 *   3. Basic_App in-process on :8130 — the run/gui API lives here even though its page is retired
 *
 * Idempotent: a door already answering is adopted, never restarted. Bind comes from HYDRA_HOST (0.0.0.0 here:
 * any device that pings gets welcomed, nothing is private, no auth).
 */
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MODULE = process.env.HYDRA_MODULE_ROOT || 'C:/AI/hydra-local/module';
const NODE = process.env.HYDRA_NODE || process.execPath;
const HOST = process.env.HYDRA_HOST || '0.0.0.0';
const PORT = Number(process.env.BASIC_PORT || 8130);

const DOORS = {
  servicesUrl: process.env.BASIC_SERVICES_URL || 'http://127.0.0.1:8128',
  pwUrl: process.env.BASIC_PW_URL || 'http://127.0.0.1:8125',
  rmUrl: process.env.BASIC_RM_URL || 'http://127.0.0.1:8129',
  stateUrl: process.env.BASIC_STATE_URL || 'http://127.0.0.1:8127',
};

// Echidna's two doors are deliberately absent: one Echidna per LAN, and this node is a service node.
const DOOR_TABLE = [
  { key: 'state', dir: 'State', port: 8127 },
  { key: 'services', dir: 'Services', port: 8128 },
  { key: 'rm', dir: 'ResourceManager', port: 8129 },
  { key: 'join', dir: 'Join', port: 8131 },
  { key: 'resolver', dir: 'StateResolver', port: 8136 },
  // the scheduler runs the LOCAL runner here: it owns the card, so it is the one that evicts and starts models
  { key: 'scheduler', dir: 'Scheduler', port: 8132, args: ['--runner', 'local'] },
  { key: 'menu', dir: 'Menu', port: 8133 },
];

const LOG_FILE = process.env.HYDRA_LOG || 'C:/AI/hydra-local/logs/shelf.log';
try { mkdirSync(path.dirname(LOG_FILE), { recursive: true }); } catch { /* fine */ }

const log = (...a) => {
  const line = `${new Date().toISOString()} ${a.join(' ')}`;
  console.log(line);
  // Task Scheduler discards a task's stdout, so the service log is written here rather than by a shell redirect.
  try { appendFileSync(LOG_FILE, line + '\n'); } catch { /* logging must never kill the shelf */ }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const doorArgs = (port, extra = []) => ['public/js/main.js', '--port', String(port), '--host', HOST, ...extra];

async function up(port, p = '/') {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch(`http://127.0.0.1:${port}${p}`, { signal: ctl.signal });
    clearTimeout(t);
    return r.status < 500;
  } catch {
    return false;
  }
}

async function waitDoor(port, p = '/', ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await up(port, p)) return true;
    await sleep(500);
  }
  return false;
}

function spawnHidden(dir, port, extra = []) {
  return spawn(NODE, doorArgs(port, extra), {
    cwd: path.join(MODULE, dir),
    windowsHide: true,
    stdio: 'ignore',
    detached: false,
  });
}

async function pwLaunch(dir, port, name, extra = []) {
  const r = await fetch(`${DOORS.pwUrl}/api/processes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, command: NODE, args: doorArgs(port, extra), cwd: path.join(MODULE, dir), tag: 'door' }),
  });
  if (!r.ok) throw new Error(`POST /api/processes -> ${r.status} ${await r.text()}`);
  return (await r.json()).process;
}

/**
 * The monitor is state, so the mining line on it must not be a per-node script deployed by hand.
 * If this node declares a miner API port, the shelf raises ONE publisher row and the board carries it;
 * a node with no miner says so and is not a special case. Same code path on every box.
 */
async function ensureMiningPublisher() {
  const ROOT = process.env.HYDRA_ROOT || 'C:/AI/hydra-local';
  const nodeJson = path.join(ROOT, 'module', 'Menu', 'data', 'node.json');
  let apiPort = 0;
  try {
    const raw = JSON.parse(readFileSync(nodeJson, 'utf8').replace(/^\uFEFF/, ''));
    const args = raw?.standby?.start?.args ?? [];
    const i = args.indexOf('--apiport');
    apiPort = i > -1 ? Number(args[i + 1]) : Number(raw?.miner?.apiPort ?? 0);
  } catch (e) {
    log(`[shelf] node.json unreadable (${e.message}) — not raising a mining publisher`);
    return;
  }
  if (!apiPort) {
    log('[shelf] this node declares no miner api port — no mining publisher');
    return;
  }
  try {
    const rows = await (await fetch(`${DOORS.pwUrl}/api/processes`)).json();
    const running = (rows.processes ?? []).some((r) => r.name === 'monitor-mining' && r.life === 'running');
    if (running) {
      log('[shelf] mining publisher already running');
      return;
    }
    const script = path.join(ROOT, 'scripts', 'monitor-mining.mjs');
    const r = await fetch(`${DOORS.pwUrl}/api/processes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'monitor-mining',
        tag: 'watch',
        command: NODE,
        args: [script, '--root', ROOT, '--echidna', '8138', '--interval', '10'],
        cwd: ROOT,
      }),
    });
    if (!r.ok) throw new Error(`POST /api/processes -> ${r.status}`);
    log(`[shelf] mining publisher raised for api port ${apiPort}`);
  } catch (e) {
    log(`[shelf] mining publisher not raised: ${e.message}`);
  }
}

async function main() {
  log(`[shelf] host=${HOST} node=${NODE}`);

  // One shelf per box. A second one would adopt half the doors, rebind the rest, and split the record between
  // two owners - worse than not starting at all. The Menu door is the signature of a shelf that is already serving.
  if (await up(8133, '/api/menu')) {
    log('[shelf] a shelf is already serving on this box - leaving it alone and exiting');
    process.exit(0);
  }

  if (await up(8125, '/api/processes')) {
    log('[shelf] ProcessWrapper already up on 8125 — adopting');
  } else {
    log('[shelf] starting ProcessWrapper hidden');
    spawnHidden('ProcessWrapper', 8125);
    if (!(await waitDoor(8125, '/api/processes', 25000))) throw new Error('ProcessWrapper never answered on 8125');
    log('[shelf] ProcessWrapper up on 8125');
  }

  for (const d of DOOR_TABLE) {
    if (await up(d.port)) {
      log(`[shelf] ${d.key} already up on ${d.port}`);
      continue;
    }
    try {
      const rec = await pwLaunch(d.dir, d.port, `${d.key}-${d.port}`, d.args || []);
      log(`[shelf] ${d.key} -> ProcessWrapper tab (${rec?.id || 'launched'})`);
    } catch (e) {
      log(`[shelf] ${d.key} via PW failed (${e.message}) — hidden fallback`);
      spawnHidden(d.dir, d.port, d.args || []);
    }
    if (!(await waitDoor(d.port))) log(`[shelf] WARNING ${d.key} not answering on ${d.port}`);
  }

  // the monitor carries the mining line because the node says it mines — not because someone deployed a script here
  await ensureMiningPublisher();

  const { createBasicServer } = await import(pathToFileURL(path.join(MODULE, 'Basic_App/public/js/basicServer.js')).href);
  const ehMod = await import(pathToFileURL(path.join(MODULE, 'Event_Handler/Event_Handler_module.js')).href);
  const eh = ehMod.createModule({ logPath: path.join(MODULE, 'Basic_App/data/events.log') });
  const seen = new Set();
  const ensure = (name) => {
    if (seen.has(name)) return;
    try { eh.handler.register(name, () => ({ ok: true })); } catch { /* already registered */ }
    seen.add(name);
  };
  const ehAdapter = {
    trigger: (name, payload) => {
      ensure(name);
      try { return eh.handler.trigger(name, payload ?? {}, { source: 'system' }); } catch { return null; }
    },
  };

  const basic = await createBasicServer({ doors: DOORS, port: PORT, host: HOST, eh: ehAdapter });
  log(`[shelf] Basic_App API on ${basic.url}`);
  log('[shelf] up — doors owned by ProcessWrapper, no window, LAN-open');

  const stop = async (sig) => {
    log(`[shelf] ${sig} — asking ProcessWrapper to stop its children`);
    try { await fetch(`${DOORS.pwUrl}/api/stop`, { method: 'POST' }); } catch { /* it is dying with us */ }
    try { await basic.stop(); } catch { /* already gone */ }
    setTimeout(() => process.exit(0), 1500);
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
}

main().catch((e) => {
  log(`[shelf] boot failed: ${e && e.stack ? e.stack : String(e)}`);
  process.exit(1);
});
