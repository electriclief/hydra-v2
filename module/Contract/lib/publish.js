/**
 * Contract - the one shape every wrapper uses to tell Hydra what it is doing, what broke, and what would fix it.
 * See module/Contract/help.html. Nothing here is a server: it is the publisher side of the protocol, so a guard, an
 * agent job or a mining launcher all report the same way instead of each inventing a branch.
 *
 * Usage from a wrapper (node or PowerShell):
 *   const c = require('.../module/Contract/lib/publish.js');
 *   await c.ok({ ref, wrapper, owner, pid });                       // heartbeat, clears the error
 *   await c.fail({ ref, wrapper, owner, code: 'POOL_UNREACHABLE', message: 'quantus:3333 refused', retryable: true,
 *                  fix: { agent: { node: 'richard', cmd: 'schtasks /run /tn "hydra-mine-gpu"' } } });
 *
 * The State URL is the node's own door unless the caller says otherwise (a LAN-tier wrapper publishes to :8148).
 */
'use strict';

const DEFAULT_STATE = process.env.CONTRACT_STATE_URL || 'http://127.0.0.1:8127';

const CODES = new Set([
  'POOL_UNREACHABLE', 'DEVICE_MISSING', 'EXE_MISSING', 'CONFIG_INVALID', 'API_SILENT', 'RESOURCE_UNUSUAL',
  'AUTH_DENIED', 'PORT_IN_USE', 'CRASHED', 'TIMEOUT', 'DEPENDENCY_DOWN', 'AGENT_SILENT', 'UNKNOWN',
]);

const STATES = new Set(['starting', 'running', 'idle', 'blocked', 'failed', 'stopped']);

function entryName(ref, wrapper) {
  if (!ref || !wrapper) throw new Error('contract: ref and wrapper are required');
  return `agent.${ref}.${wrapper}`;
}

/** A fix is declared, never improvised. An unknown kind is refused here rather than executed later. */
function checkFix(fix) {
  if (!fix) return null;
  if (typeof fix !== 'object') throw new Error('contract: fix must be an object');
  const kinds = ['http', 'pw', 'agent', 'task'].filter((k) => fix[k]);
  if (!kinds.length) throw new Error('contract: fix must declare http, pw, agent or task');
  return fix;
}

function build({ ref, wrapper, owner, state, error = null, fix = null, needsHuman = false, pid = null,
                 host = null, tier = 'node', restarts = 0, lastOkAt = null, extra = {} }) {
  const st = STATES.has(state) ? state : (error ? 'failed' : 'running');
  if (error && !CODES.has(error.code)) {
    // an unplanned failure is UNKNOWN, which escalates - inventing a code would hide it behind a retry loop
    error = { ...error, code: 'UNKNOWN' };
  }
  return {
    ref, wrapper, owner: owner || null, host, tier,
    state: st,
    at: new Date().toISOString(),
    lastOkAt: lastOkAt || (st === 'running' ? new Date().toISOString() : null),
    pid, restarts,
    error,
    fix: checkFix(fix),
    needs_human: Boolean(needsHuman),
    ...extra,
  };
}

async function publish(content, { stateUrl = DEFAULT_STATE, timeoutMs = 1500 } = {}) {
  const name = entryName(content.ref, content.wrapper);
  const res = await fetch(`${stateUrl.replace(/\/$/, '')}/api/state/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, content }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`contract: ${name} -> HTTP ${res.status}`);
  return { name, content };
}

/** Heartbeat: this wrapper is fine, and saying so clears whatever error it published before. */
function ok(fields, opts) {
  return publish(build({ ...fields, state: fields.state || 'running', error: null }), opts);
}

/** Failure: what broke, whether a restart may help, and the declared remedy (if any). */
function fail(fields, opts) {
  return publish(build({ ...fields, state: fields.state || 'failed' }), opts);
}

/** Escalation: the declared fix was tried and did not work, so a person is needed. */
function needsHuman(fields, opts) {
  return publish(build({ ...fields, state: 'blocked', needsHuman: true }), opts);
}

/**
 * Wrap any async job so a throw becomes a reported failure instead of a silent gap in the fleet's picture.
 * `job` gets no arguments; the wrapper's identity fields are published before and after the run.
 */
async function guard(fields, job, opts) {
  await publish(build({ ...fields, state: 'starting' }), opts).catch(() => null);
  const t0 = Date.now();
  try {
    const result = await job();
    await ok({ ...fields, extra: { ...(fields.extra || {}), ms: Date.now() - t0 } }, opts).catch(() => null);
    return { ok: true, result };
  } catch (error) {
    await fail({
      ...fields,
      error: { code: fields.code || 'CRASHED', message: String(error && error.message || error), at: new Date().toISOString(),
               retryable: fields.retryable !== false },
    }, opts).catch(() => null);
    return { ok: false, error };
  }
}

module.exports = { CODES, STATES, build, publish, ok, fail, needsHuman, guard, entryName, DEFAULT_STATE };
