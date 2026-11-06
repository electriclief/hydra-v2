/**
 * @module main
 * @description The entry point: reads the flags, builds the wrapper + hub, puts the API on
 *              a port and keeps it there until asked to stop.
 * @intent One command to run the whole thing (`node public/js/main.js`). Server settings
 *         come from flags and the environment ONLY — `data.yaml` belongs to the saved
 *         commands, and nothing here ever rewrites a part of it it does not own (a hand
 *         edit there can never be silently dropped).
 */

import process from 'node:process';
import path from 'node:path';
import type { ProcessWrapperService } from './processWrapper.js';
import type { StreamHub } from './streamHub.js';
import type { ApiServer } from './apiServer.js';
import { createWrapper } from './processWrapper.js';
import { createStreamHub } from './streamHub.js';
import { startApiServer } from './apiServer.js';
import { createConsoleEvents, type ConsoleEvents } from './consoleEvents.js';
import { createSystemWatch, type SystemWatch } from './systemWatch.js';
import { captureRootLife } from './rootLife.js';

// --- Interface Definitions ---

export interface MainOptions {
  port: number;
  host: string;
  token: string | null;
  /** data.yaml holding the saved commands. */
  registryFile: string;
  /** Directory holding one text file per process life. */
  streamDir: string;
  bufferLimitChars: number;
  graceMs: number;
  /** Start it and say nothing (tests). */
  quiet: boolean;
  /** Boot the drain watch with the wrapper: sampler child + small logs + a note per drain. */
  watch: boolean;
}

/** Everything main() built, so a caller can drive or stop it. */
export interface RunningWrapper {
  wrapper: ProcessWrapperService;
  hub: StreamHub;
  api: ApiServer;
  /** The console palette — the three events any hand can fire at this wrapper. */
  palette: ConsoleEvents;
  /** The drain watch, when armed (null when started with watch: false). */
  watch: SystemWatch | null;
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
      const envName = 'PW_' + name.replace(/^--/, '').replace(/-/g, '_').toUpperCase();
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
  const registryFile = get(['--registry', '--registry-file']) ?? path.join(process.cwd(), 'data.yaml');
  return {
    port: num(['--port'], 8125),
    host: get(['--host']) || '127.0.0.1',
    token: get(['--token']) || null,
    registryFile,
    streamDir: get(['--stream-dir']) ?? path.join(process.cwd(), 'data', 'streams'),
    bufferLimitChars: num(['--buffer-limit'], 4_000_000),
    graceMs: num(['--grace-ms'], 3000),
    quiet: argv.includes('--quiet'),
    watch: !argv.includes('--no-watch'),
  };
}

/** Build the wrapper, the hub and the API around the given options. */
export async function startWrapper(options: Partial<MainOptions> = {}): Promise<RunningWrapper> {
  const full: MainOptions = {
    port: 8125,
    host: '127.0.0.1',
    token: null,
    registryFile: path.join(process.cwd(), 'data.yaml'),
    streamDir: path.join(process.cwd(), 'data', 'streams'),
    bufferLimitChars: 4_000_000,
    graceMs: 3000,
    quiet: false,
    watch: false,
    ...options,
  };
  const wrapper = createWrapper({
    streamDir: full.streamDir,
    bufferLimitChars: full.bufferLimitChars,
    graceMs: full.graceMs,
    killTree: true,
  });
  const hub = createStreamHub(wrapper);
  // THE ROOT CAPTURES ITS OWN LIFE, before anything else is built.
  // Its law says one life = one file and nothing hidden; the root was the exception to
  // both. Now its own stdout/stderr land in streams/root.log and it can be published as
  // a row of its own table — so the console window is no longer load-bearing and the box
  // can run with ONE window instead of a stray console beside it.
  const rootLife = captureRootLife({ streamDir: full.streamDir });
  /** Filled in once the running object exists - the api must be able to fire the stop-all. */
  const stopper: { go: (() => void) | null } = { go: null };
  const palette = await createConsoleEvents({
    wrapper,
    logPath: path.join(path.dirname(full.streamDir), 'console-events.log'),
    defaultCwd: process.cwd(),
  });
  const api = await startApiServer({
    wrapper,
    hub,
    palette,
    port: full.port,
    host: full.host,
    token: full.token,
    registryFile: full.registryFile,
    rootRecord: rootLife.record,
    onStop: () => stopper.go?.(),
  });
  let watch: SystemWatch | null = null;
  if (full.watch) {
    watch = await createSystemWatch({
      wrapper,
      notify: (record) => {
        // Every drain rides the same event machinery as everything else: the palette logs
        // the receipt with its source, and any surface reading the log sees it.
        palette.trigger('note System Drain', record as unknown as Record<string, unknown>, 'system-watch');
      },
    });
  }
  const running: RunningWrapper = {
    wrapper,
    hub,
    api,
    palette,
    watch,
    options: full,
    stop: async () => {
      if (watch) await watch.stop();
      rootLife.close();
      await wrapper.shutdown(true);
      await api.stop();
      palette.close();
    },
  };
  // THE STOP-ALL: every child dies, the door closes, the root leaves. Nothing survives
  // the stop, because leaving something behind is the one thing this wrapper forbids.
  stopper.go = () => {
    void running.stop().then(() => {
      process.exitCode = 0;
      setTimeout(() => process.exit(0), 300).unref();
    });
  };
  return running;
}

/** The banner — where it listens, what it can be asked, where the text lands. */
export function banner(running: RunningWrapper): string {
  const { api, options } = running;
  return [
    'ProcessWrapper — commands in, text streams out.',
    `  GUI      ${api.url}/                      (start · watch · kill)`,
    `  API      ${api.url}`,
    `  MCP      ${api.url}/mcp                   (agents: initialize → tools/list → tools/call)`,
    `  health   GET  ${api.url}/health`,
    `  launch   POST ${api.url}/api/processes   {"command":"python bar.py"}`,
    `  copy     GET  ${api.url}/api/processes/<id>/output`,
    `  live     GET  ${api.url}/api/processes/<id>/stream   (SSE)`,
    `  kill     POST ${api.url}/api/processes/<id>/kill     {"force":true}`,
    `  events   GET  ${api.url}/api/events   POST ${api.url}/api/events/trigger  {"name":"add Process Console Display"}`,
    running.watch
      ? `  watch    armed — sampler child "system-watch"; drain notes + small logs in ${path.resolve(running.watch.logDir)}`
      : '  watch    off — pass --watch to arm the drain watch',
    `  streams  ${path.resolve(options.streamDir)}   (one file per process life)`,
    `  saved    ${path.resolve(options.registryFile)}`,
    options.token ? '  token    required for /api and /mcp (x-pw-token) — the GUI asks for it' : '  token    none — bind is local only; pass --token to guard it',
  ].join('\n');
}

/** Run it: build, announce, and hold the process until a stop signal. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<RunningWrapper> {
  const options = parseArgs(argv);
  const running = await startWrapper(options);
  if (!options.quiet) {
    console.log(banner(running));
    console.log('  stop     Ctrl+C');
  }
  const shutdown = async (signal: string) => {
    if (!options.quiet) console.log(`\n[processWrapper] ${signal} — stopping every child and closing the port`);
    await running.stop();
    // Let Node drain and exit on its own; force the door only if something lingers.
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
    console.error('[processWrapper] failed to start:', (err as Error).message);
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

  // 1. flags
  const defaults = parseArgs([], {});
  ok('defaults bind to the loopback on 8125', defaults.port === 8125 && defaults.host === '127.0.0.1', JSON.stringify(defaults));
  ok('no token by default', defaults.token === null);
  const flags = parseArgs(['--port', '9100', '--host', '0.0.0.0', '--token', 'abc', '--grace-ms', '250', '--stream-dir', 'C:/tmp/streams', '--registry', 'C:/tmp/data.yaml'], {});
  ok('flags are read', flags.port === 9100 && flags.host === '0.0.0.0' && flags.token === 'abc', JSON.stringify(flags));
  ok('the grace window flag reaches the wrapper', flags.graceMs === 250, String(flags.graceMs));
  ok('paths are taken as given', flags.streamDir === 'C:/tmp/streams' && flags.registryFile === 'C:/tmp/data.yaml', JSON.stringify(flags.streamDir));
  const inline = parseArgs(['--port=9200', '--quiet'], {});
  ok('--flag=value works', inline.port === 9200 && inline.quiet === true, JSON.stringify(inline));
  const fromEnv = parseArgs([], { PW_PORT: '9300', PW_TOKEN: 'envtok', PW_HOST: '10.0.0.5' });
  ok('the environment is read', fromEnv.port === 9300 && fromEnv.token === 'envtok' && fromEnv.host === '10.0.0.5', JSON.stringify(fromEnv));
  const beats = parseArgs(['--port', '9400'], { PW_PORT: '9300' });
  ok('a flag beats the environment', beats.port === 9400, String(beats.port));
  const junk = parseArgs(['--port', 'not-a-number'], {});
  ok('junk falls back instead of throwing', junk.port === 8125, String(junk.port));
  const watchDefault = parseArgs([], {}).watch;
  const watchOff = parseArgs(['--no-watch'], {}).watch;
  ok('the drain watch is on by default, off with --no-watch', watchDefault === true && watchOff === false, `${watchDefault}/${watchOff}`);

  // 2. a real boot on a free port, then a real health check
  const dir = (await import('node:fs')).mkdtempSync(path.join((await import('node:os')).tmpdir(), 'pw-main-'));
  const running = await startWrapper({
    port: 0,
    quiet: true,
    streamDir: path.join(dir, 'streams'),
    registryFile: path.join(dir, 'data.yaml'),
  });
  const url = running.api.url;
  const health = (await (await fetch(url + '/health')).json()) as { ok: boolean; module: string };
  ok('startWrapper really binds a port', /^http:\/\/127\.0\.0\.1:\d+$/.test(url) && running.api.port > 0, url);
  ok('the bound api answers health', health.ok === true && health.module === 'processWrapper', JSON.stringify(health));
  const launched = await running.wrapper.launch({ name: 'main-probe', command: process.execPath, args: ['-e', "console.log('main-ok')"] });
  await running.wrapper.awaitExit(launched.id, 15000);
  const text = await (await fetch(`${url}/api/processes/${launched.id}/output`)).text();
  ok('a process launched in-process is served over the port', text.includes('main-ok'), text);
  const text2 = banner(running);
  ok('the banner names the api and the stream dir', text2.includes(url) && text2.includes(path.resolve(running.options.streamDir)), text2.slice(0, 200));
  await running.stop();
  const afterStop = await fetch(url + '/health').catch(() => null);
  ok('stop really closes the port and kills the children', afterStop === null, afterStop ? String(afterStop.status) : 'closed');

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[main] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}

// runTests();
