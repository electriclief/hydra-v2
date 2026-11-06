/**
 * @module main
 * @description The entry point: reads the flags, builds the handler, puts the API on a
 *              port and keeps it there until asked to stop.
 * @intent One command to run the whole thing (`node public/js/main.js`). Settings come
 *         from flags and the environment ONLY. The log path is the flag the operator
 *         owns: `--log <path>` (default ./data/events.log).
 */

import process from 'node:process';
import path from 'node:path';
import { createEventHandler, type EventHandler } from './eventHandler.js';
import { startApiServer, type ApiServer } from './apiServer.js';

// --- Interface Definitions ---

export interface MainOptions {
  port: number;
  host: string;
  token: string | null;
  /** THE path — where events are logged (one rolling JSONL file). */
  logPath: string;
  retentionHours: number;
  maxBytes: number;
  /** Start it and say nothing (tests). */
  quiet: boolean;
}

export interface RunningEventHandler {
  handler: EventHandler;
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
      const envName = 'EH_' + name.replace(/^--/, '').replace(/-/g, '_').toUpperCase();
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
    port: num(['--port'], 8126),
    host: get(['--host']) || '127.0.0.1',
    token: get(['--token']) || null,
    logPath: get(['--log', '--log-path']) ?? path.join(process.cwd(), 'data', 'events.log'),
    retentionHours: num(['--retention-hours'], 24),
    maxBytes: num(['--max-bytes'], 8_000_000),
    quiet: argv.includes('--quiet'),
  };
}

/** Build the handler + the API around the given options. */
export async function startWrapper(options: Partial<MainOptions> = {}): Promise<RunningEventHandler> {
  const full: MainOptions = {
    port: 8126,
    host: '127.0.0.1',
    token: null,
    logPath: path.join(process.cwd(), 'data', 'events.log'),
    retentionHours: 24,
    maxBytes: 8_000_000,
    quiet: false,
    ...options,
  };
  const handler = createEventHandler({
    logPath: full.logPath,
    retentionHours: full.retentionHours,
    maxBytes: full.maxBytes,
  });
  handler.start();
  const api = await startApiServer({
    handler,
    port: full.port,
    host: full.host,
    token: full.token,
  });
  return {
    handler,
    api,
    options: full,
    stop: async () => {
      await api.stop();
      handler.close();
    },
  };
}

/** The banner — where it listens, what can be fired, where the record lands. */
export function banner(running: RunningEventHandler): string {
  const { api, options } = running;
  return [
    'Event_Handler — register · trigger · log.',
    `  GUI      ${api.url}/                          (the palette + the live log)`,
    `  API      GET  ${api.url}/api/events            (the palette)`,
    `  fire     POST ${api.url}/api/events/trigger   {"name":"...","payload":{}}`,
    `  read     GET  ${api.url}/api/events/log        (?limit=&name=&source=)`,
    `  live     GET  ${api.url}/api/events/stream     (SSE)`,
    `  trim     POST ${api.url}/api/events/purge`,
    `  MCP      POST ${api.url}/mcp                   (agents: initialize → tools/list → tools/call)`,
    `  log      ${path.resolve(options.logPath)}   (one rolling file, ~${options.retentionHours} h)`,
    options.token ? '  token    required for /api and /mcp (x-eh-token) — the GUI asks for it' : '  token    none — bind is local only; pass --token to guard it',
  ].join('\n');
}

/** Run it: build, announce, and hold the process until a stop signal. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<RunningEventHandler> {
  const options = parseArgs(argv);
  const running = await startWrapper(options);
  if (!options.quiet) {
    console.log(banner(running));
    console.log('  stop     Ctrl+C');
  }
  const shutdown = async (signal: string) => {
    if (!options.quiet) console.log(`\n[eventHandler] ${signal} — closing the door`);
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
    console.error('[eventHandler] failed to start:', (err as Error).message);
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
  ok('defaults bind the loopback on 8126', defaults.port === 8126 && defaults.host === '127.0.0.1', JSON.stringify(defaults));
  ok('the default log lands under data/', defaults.logPath.endsWith(path.join('data', 'events.log')), defaults.logPath);
  ok('default retention ~24 h', defaults.retentionHours === 24 && defaults.maxBytes === 8_000_000);

  const flags = parseArgs(['--port', '9100', '--log', 'C:/tmp/ev.log', '--retention-hours', '6', '--token', 'abc'], {});
  ok('flags are read', flags.port === 9100 && flags.logPath === 'C:/tmp/ev.log' && flags.retentionHours === 6 && flags.token === 'abc');

  const inline = parseArgs(['--port=9200', '--quiet'], {});
  ok('--flag=value works', inline.port === 9200 && inline.quiet === true);

  const fromEnv = parseArgs([], { EH_PORT: '9300', EH_LOG: 'C:/env/ev.log', EH_TOKEN: 'envtok' });
  ok('the environment is read', fromEnv.port === 9300 && fromEnv.logPath === 'C:/env/ev.log' && fromEnv.token === 'envtok');

  const beats = parseArgs(['--port', '9400'], { EH_PORT: '9300' });
  ok('a flag beats the environment', beats.port === 9400);

  const junk = parseArgs(['--port', 'not-a-number'], {});
  ok('junk falls back instead of throwing', junk.port === 8126);

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[main] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}

// runTests();
