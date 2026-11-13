#!/usr/bin/env node
/**
 * access.mjs - the controller's hand on any node's EchidnaAccess agent.
 *
 *   node scripts/access.mjs health --node 192.168.1.149
 *   node scripts/access.mjs "sc.exe query sshd" --node 192.168.1.149        (exec is the default verb)
 *   node scripts/access.mjs --node 192.168.1.149 --cwd C:\AI --timeout 300 "npm test"
 *   node scripts/access.mjs audit --node 192.168.1.149 --limit 10
 *
 * Tokens live in C:/AI/fleet/access.json keyed by ip or roster ref:
 *   { "192.168.1.149": { "ref": "gtx1660", "port": 8142, "token": "…" } }
 * `--token` and ECHIDNA_ACCESS_TOKEN override the file (a one-off).
 *
 * Exit code is the REMOTE exit code, so a script can rely on it. stdout and stderr are passed through untouched;
 * the agent's JSON envelope is what carries the exit code and timing.
 */
import fs from 'node:fs';
import path from 'node:path';

const LEDGER = 'C:/AI/fleet/access.json';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const at = argv.indexOf(`--${name}`);
  if (at < 0) return fallback;
  const v = argv[at + 1];
  return v && !v.startsWith('--') ? v : true;
};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) { if (argv[i + 1] && !argv[i + 1].startsWith('--')) i++; continue; }
  positional.push(argv[i]);
}

const verb = ['health', 'exec', 'audit'].includes(positional[0]) ? positional.shift() : 'exec';
const command = positional.join(' ');
const node = String(flag('node', ''));
if (!node) {
  console.error('usage: node scripts/access.mjs [health|exec|audit] --node <ip|ref> [--cmd "…" | "…"] [--cwd D] [--timeout S] [--limit N]');
  process.exit(2);
}

function readLedger() {
  try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch { return {}; }
}

/** Accept an ip, an ip with a port, or a roster ref - the ledger decides where to send it. */
function resolve(target) {
  const ledger = readLedger();
  const direct = ledger[target];
  if (direct) return { ip: target, ...direct };
  for (const [ip, entry] of Object.entries(ledger)) {
    if (entry && entry.ref && entry.ref.toLowerCase() === target.toLowerCase()) return { ip, ...entry };
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(target)) return { ip: target, port: 8142, token: '' };
  return null;
}

const target = resolve(node);
if (!target) {
  console.error(`no ledger entry and not an ip: ${node}  (see ${LEDGER})`);
  process.exit(2);
}
const port = Number(flag('port', target.port || 8142));
const token = String(flag('token', process.env.ECHIDNA_ACCESS_TOKEN || target.token || '')).trim();
// No token is a valid configuration: an agent without token.txt is OPEN (the operator's default). The header is only
// sent when there is something to send, so an open agent is not confused by an empty credential.
const base = `http://${target.ip}:${port}`;
const headers = { 'content-type': 'application/json' };
if (token) headers['x-access-token'] = token;

async function call(pathname, init = {}, timeoutMs = 30000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(base + pathname, { ...init, headers, signal: ctl.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text };
  } finally { clearTimeout(timer); }
}

const t0 = Date.now();
if (verb === 'health') {
  try {
    const h = await call('/health', {}, 5000);
    if (!h.json) { console.error(`HTTP ${h.status}: ${h.text.slice(0, 300)}`); process.exit(1); }
    console.log(JSON.stringify(h.json, null, 2));
    process.exit(h.json.ok ? 0 : 1);
  } catch (err) {
    console.error(`${target.ip}:${port} unreachable (${err.name === 'AbortError' ? 'timeout' : err.message})`);
    process.exit(1);
  }
}

if (verb === 'audit') {
  const limit = Number(flag('limit', 20));
  const a = await call(`/audit?limit=${limit}`, {}, 8000);
  if (!a.json) { console.error(`HTTP ${a.status}: ${a.text.slice(0, 300)}`); process.exit(1); }
  for (const row of a.json.rows || []) {
    const when = row.at ? row.at.slice(0, 19).replace('T', ' ') : '?';
    const verdict = row.refused ? `REFUSED ${row.refused}` : `exit ${row.exitCode} ${row.ms}ms`;
    console.log(`${when}  ${String(row.ip || '').padEnd(15)}  ${verdict}  ${(row.cmd || row.path || '').slice(0, 120)}`);
  }
  process.exit(0);
}

const cmd = String(flag('cmd', command || '')).trim();
if (!cmd) { console.error('nothing to run: pass --cmd "…" or put the command last'); process.exit(2); }
const body = { cmd };
if (flag('cwd')) body.cwd = flag('cwd');
if (flag('timeout')) body.timeoutSec = Number(flag('timeout'));

try {
  const r = await call('/exec', { method: 'POST', body: JSON.stringify(body) }, (body.timeoutSec || 120) * 1000 + 15000);
  if (!r.json) { console.error(`HTTP ${r.status}: ${r.text.slice(0, 400)}`); process.exit(1); }
  if (!r.json.ok) { console.error(`refused: ${r.json.error}`); process.exit(1); }
  if (r.json.stdout) process.stdout.write(r.json.stdout);
  if (r.json.stderr) process.stderr.write(r.json.stderr);
  if (process.env.ECHIDNA_ACCESS_QUIET !== '1') {
    console.error(`— ${r.json.host} as ${r.json.user} · exit ${r.json.exitCode} · ${r.json.ms}ms${r.json.killed ? ' · KILLED at the timeout' : ''} · ${Date.now() - t0}ms round trip`);
  }
  process.exit(Number(r.json.exitCode) || 0);
} catch (err) {
  console.error(`${target.ip}:${port} unreachable (${err.name === 'AbortError' ? 'timeout' : err.message})`);
  process.exit(1);
}
