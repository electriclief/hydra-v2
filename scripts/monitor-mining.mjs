#!/usr/bin/env node
/**
 * monitor-mining.mjs — the mining story on the Hydra MONITOR, not in a console window.
 *
 * The operator's point (2026-11-10): "I can see the Hydra Menu Monitor — why not just put this on the monitor?"
 * The wall window is evidence a person can stand in front of; the monitor is the compressed idea of the node, so it
 * should carry the one line that matters — the rate, the shares, and whether it is running — and it should say so when
 * that changes, not every time it polls.
 *
 * The Echidna contract is deliberately not a feed: POST /api/monitor pushes a card onto a stack of at most 40, and the
 * board shows one. So this publishes on CHANGE only:
 *   - the miner answered after not answering        -> output "mining"
 *   - the accepted count went up                     -> output "share accepted #N"
 *   - the rate moved by more than RATE_STEP          -> output "rate"
 *   - the miner stopped answering for 3 polls        -> question "mining stopped"
 *   - nothing has changed for HEARTBEAT_MIN minutes  -> output "still mining"
 * Every post is also appended to logs/monitor-mining.log, because a publisher that says nothing is indistinguishable
 * from one that is broken.
 *
 * Usage: node monitor-mining.mjs [--root C:\AI\hydra-local] [--echidna 8138] [--interval 10] [--once]
 */
import fs from 'node:fs';
import path from 'node:path';

const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const ROOT = arg('root', 'C:\\AI\\hydra-local');
const ECHIDNA = Number(arg('echidna', 8138));
const INTERVAL = Number(arg('interval', 10));
const ONCE = process.argv.includes('--once');
const RATE_STEP = 0.05;          // MH/s — a move smaller than this is noise, not news
const HEARTBEAT_MIN = 15;
const LOG = path.join(ROOT, 'logs', 'monitor-mining.log');

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
function log(line) {
  const text = `${stamp()}  ${line}`;
  console.log(text);
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, text + '\n');
  } catch { /* a log that cannot be written must not stop the board */ }
}

/** The miner's API port lives in the node's own declaration, never in this file. */
function readNode() {
  const file = path.join(ROOT, 'module', 'Menu', 'data', 'node.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const args = raw?.standby?.start?.args ?? [];
  const i = args.indexOf('--apiport');
  const port = i > -1 ? Number(args[i + 1]) : Number(raw?.miner?.apiPort ?? 0);
  return { ref: raw?.ref ?? 'node', port, label: raw?.standby?.label ?? 'mining' };
}

async function ask(port) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 5000);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/`, { signal: ctl.signal });
    if (!r.ok) return { ok: false, why: `http ${r.status}` };
    const j = await r.json();
    const a = Array.isArray(j.Algorithms) ? j.Algorithms[0] : null;
    if (!a) return { ok: false, why: 'no algorithm in the answer' };
    return {
      ok: true,
      algo: String(a.Algorithm ?? ''),
      rate: Number(a.Total_Performance ?? 0),
      accepted: Number(a.Total_Accepted ?? 0),
      rejected: Number(a.Total_Rejected ?? 0),
      uptime: Math.round(Number(j.Session?.Uptime ?? 0) / 60),
    };
  } catch (e) {
    return { ok: false, why: e.name === 'AbortError' ? 'timed out' : (e.message || 'unreachable') };
  } finally {
    clearTimeout(t);
  }
}

async function card(kind, title, text) {
  try {
    const r = await fetch(`http://127.0.0.1:${ECHIDNA}/api/monitor`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, title, text }),
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) { log(`POST /api/monitor -> ${r.status}, card not placed: ${title}`); return false; }
    log(`card [${kind}] ${title} — ${text}`);
    return true;
  } catch (e) {
    log(`POST /api/monitor failed (${e.message}); card not placed: ${title}`);
    return false;
  }
}

const money = (n) => (Number.isFinite(n) ? n.toFixed(2) : '0.00');

async function main() {
  let node;
  try {
    node = readNode();
  } catch (e) {
    log(`cannot read node.json (${e.message}) — refusing to guess a miner port, stopping.`);
    process.exit(13);
  }
  if (!node.port) {
    log('node.json declares no --apiport for its standby miner — nothing to watch, stopping.');
    process.exit(13);
  }
  log(`watching ${node.ref}: miner api 127.0.0.1:${node.port}, monitor on 127.0.0.1:${ECHIDNA}, every ${INTERVAL}s`);

  let last = null;          // last good reading
  let misses = 0;           // consecutive failures
  let saidStopped = false;
  let lastPost = 0;         // when we last put something on the board
  let lastAccepted = -1;
  let lastRate = -1;

  for (;;) {
    const r = await ask(node.port);
    if (r.ok) {
      const line = `${money(r.rate)} MH/s · A${r.accepted} R${r.rejected} · up ${r.uptime} min`;
      const resumed = !last || misses > 0;
      const share = r.accepted > lastAccepted && lastAccepted >= 0;
      const moved = Math.abs(r.rate - lastRate) >= RATE_STEP;
      const beat = (Date.now() - lastPost) / 60000 >= HEARTBEAT_MIN;

      if (resumed) {
        await card('output', `${node.ref} · mining`, `${r.algo} ${line}`);
      } else if (share) {
        await card('output', `${node.ref} · share accepted #${r.accepted}`, `${money(r.rate)} MH/s · A${r.accepted} R${r.rejected} · up ${r.uptime} min`);
      } else if (moved) {
        await card('output', `${node.ref} · rate`, line);
      } else if (beat) {
        await card('output', `${node.ref} · still mining`, line);
      }
      if (resumed || share || moved || beat) {
        lastPost = Date.now();
        lastAccepted = r.accepted;
        lastRate = r.rate;
      }
      last = r; misses = 0; saidStopped = false;
    } else {
      misses += 1;
      if (misses >= 3 && !saidStopped) {
        await card(
          'question',
          `${node.ref} · mining stopped`,
          `no answer on 127.0.0.1:${node.port} for ${misses * INTERVAL}s (${r.why}). The guard owns the restart — if it stays quiet, this node needs a hand.`,
        );
        saidStopped = true; lastPost = Date.now();
      }
      if (misses === 3) log(`miner silent: ${r.why}`);
    }
    if (ONCE) break;
    await new Promise((res) => setTimeout(res, INTERVAL * 1000));
  }
}

main().catch((e) => { log(`fatal: ${e.stack || e.message}`); process.exit(1); });
