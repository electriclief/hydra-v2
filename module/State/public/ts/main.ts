/**
 * @module main
 * @description The entry point: reads the flags, builds the registry, puts the API on a
 *              port and keeps it there until asked to stop.
 * @intent One command to run the whole thing (`node public/js/main.js`). Settings come
 *         from flags and the environment ONLY. Nothing persists — the registry boots
 *         blank and holds what it is handed, for as long as it is handed.
 */

import process from 'node:process';
import { createStateRegistry, type State } from './stateRegistry.js';
import { startApiServer, type ApiServer } from './apiServer.js';

// --- Interface Definitions ---

export interface MainOptions {
  port: number;
  host: string;
  token: string | null;
  /** Start it and say nothing (tests). */
  quiet: boolean;
}

export interface RunningState {
  state: State;
  api: ApiServer;
  options: MainOptions;
  stop(): Promise<void>;
}

// --- Function Definitions ---

/** Flags + environment → options. Precedence: flag → environment → default. */
export function parseArgs(argv: string[], env: Record<string, string | undefined> = process.env): MainOptions {
  const get = (names: string[]): string | null => {
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      for (const name of names) {
        if (arg === name) return argv[i + 1] ?? '';
        if (arg.startsWith(name + '=')) return arg.slice(name.length + 1);
      }
    }
    for (const name of names) {
      const envName = 'STATE_' + name.replace(/^--/, '').replace(/-/g, '_').toUpperCase();
      if (env[envName]) return String(env[envName]);
    }
    return null;
  };
  const num = (names: string[], fallback: number): number => {
    const raw = get(names);
    if (raw === null || raw === '') return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    port: num(['--port'], 8127),
    host: get(['--host']) || '127.0.0.1',
    token: get(['--token']) || null,
    quiet: argv.includes('--quiet'),
  };
}

/** Build the registry + the API around the given options. */
export async function startState(options: Partial<MainOptions> = {}): Promise<RunningState> {
  const full: MainOptions = {
    port: 8127,
    host: '127.0.0.1',
    token: null,
    quiet: false,
    ...options,
  };
  const state = createStateRegistry();
  const api = await startApiServer({
    state,
    port: full.port,
    host: full.host,
    token: full.token,
  });
  return {
    state,
    api,
    options: full,
    stop: async () => {
      await api.stop();
      state.close();
    },
  };
}

/** The banner — where it listens, what it holds, what walks the door. */
export function banner(running: RunningState): string {
  const { api } = running;
  return [
    'State — register · pull · discover · relay.',
    `  GUI      ${api.url}/                          (the held set + the pull bench)`,
    `  list     GET  ${api.url}/api/state            (?q=path|leaf|parent)`,
    `  pull     GET  ${api.url}/api/state/pull       (?name=...&marks={"key":N})`,
    `  register POST ${api.url}/api/state/register   {"name":"...","content":{...}}`,
    `  drop     POST ${api.url}/api/state/drop       {"name":"..."}`,
    `  live     GET  ${api.url}/api/state/stream     (SSE — the change feed)`,
    `  MCP      POST ${api.url}/mcp                   (agents: initialize → tools/list → tools/call)`,
    '  hold     nothing persists — the registry boots blank; entries live with their registrants',
    running.options.token ? '  token    required for /api and /mcp (x-state-token) — the GUI asks for it' : '  token    none — bind is local only; pass --token to guard it',
  ].join('\n');
}

/** Run it: build, announce, and hold the process until a stop signal. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<RunningState> {
  const options = parseArgs(argv);
  const running = await startState(options);
  if (!options.quiet) {
    console.log(banner(running));
    console.log('  stop     Ctrl+C');
  }
  const shutdown = async (signal: string) => {
    if (!options.quiet) console.log(`\n[state] ${signal} — closing the door`);
    await running.stop();
    process.exitCode = 0;
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  return running;
}

/** Was this file run directly (as opposed to imported)? */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return /main\.(js|ts)$/.test(entry);
}

if (isDirectRun()) {
  main().catch((err) => {
    console.error('[state] failed to start:', (err as Error).message);
    process.exit(1);
  });
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };

  const defaults = parseArgs([], {});
  ok('defaults bind the loopback on 8127', defaults.port === 8127 && defaults.host === '127.0.0.1', JSON.stringify(defaults));
  ok('no token by default', defaults.token === null);

  const flags = parseArgs(['--port', '9100', '--token', 'abc'], {});
  ok('flags are read', flags.port === 9100 && flags.token === 'abc');

  const inline = parseArgs(['--port=9200', '--quiet'], {});
  ok('--flag=value works', inline.port === 9200 && inline.quiet === true);

  const fromEnv = parseArgs([], { STATE_PORT: '9300', STATE_HOST: '0.0.0.0', STATE_TOKEN: 'envtok' });
  ok('the environment is read', fromEnv.port === 9300 && fromEnv.host === '0.0.0.0' && fromEnv.token === 'envtok');

  const beats = parseArgs(['--port', '9400'], { STATE_PORT: '9300' });
  ok('a flag beats the environment', beats.port === 9400);

  const junk = parseArgs(['--port', 'not-a-number'], {});
  ok('junk falls back instead of throwing', junk.port === 8127);

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[main] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}

// runTests();
