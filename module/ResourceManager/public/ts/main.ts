/**
 * @module main
 * @description Boot: the register's door on 8129 — the booking store (data/bookings.json),
 *              the machine reader, and the HTTP face (GUI · API · MCP) on one port. Flags >
 *              environment (RM_*) > defaults; `--help` prints what this box is.
 * @intent The module runs the moment it starts — `node public/js/main.js`. The banner names
 *         every door and every file it owns; nothing runs invisibly. Nothing here decides
 *         anything: poll · book · pop · clear — the scheduler (later) does the thinking.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBookingStore, type BookingStore } from './bookingStore.js';
import { collectReads, loadShareList } from './resourceRead.js';
import { startApiServer } from './apiServer.js';

// --- Interface Definitions ---

export interface MainOptions {
  port: number;
  host: string;
  token: string | null;
  /** The folder where bookings.json lives (default ./data). */
  dataDir: string;
  /** The declared shared folders file (default <dataDir>/shares.json; '' = follow dataDir). */
  sharesFile: string;
  quiet: boolean;
}

export interface RunningResourceManager {
  store: BookingStore;
  api: Awaited<ReturnType<typeof startApiServer>>;
  options: MainOptions;
  stop(): Promise<void>;
}

export const DEFAULTS: MainOptions = {
  port: 8129,
  host: '127.0.0.1',
  token: null,
  dataDir: './data',
  sharesFile: '',
  quiet: false,
};

// --- Function Definitions ---

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): { options: MainOptions; help: boolean } {
  const options: MainOptions = { ...DEFAULTS };
  const envPort = Number.parseInt((env.RM_PORT ?? '').trim(), 10);
  if (Number.isFinite(envPort) && envPort > 0) options.port = envPort;
  options.host = (env.RM_HOST ?? '').trim() || options.host;
  options.token = (env.RM_TOKEN ?? '').trim() || null;
  options.dataDir = (env.RM_DATA ?? '').trim() || options.dataDir;
  options.sharesFile = (env.RM_SHARES ?? '').trim() || options.sharesFile;

  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => String(argv[i + 1] ?? '');
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--port') {
      const port = Number.parseInt(next(), 10);
      if (Number.isFinite(port) && port >= 0) options.port = port;
      i++;
    } else if (arg === '--host') {
      options.host = next().trim() || options.host;
      i++;
    } else if (arg === '--token') {
      options.token = next().trim() || null;
      i++;
    } else if (arg === '--data') {
      options.dataDir = next().trim() || options.dataDir;
      i++;
    } else if (arg === '--shares') {
      options.sharesFile = next().trim() || options.sharesFile;
      i++;
    } else if (arg === '--quiet' || arg === '-q') options.quiet = true;
  }
  return { options, help };
}

export function printHelp(): void {
  console.log(
    [
      'resource-manager — the register of this node (reads resources; keeps bookings; never locks, never enforces)',
      '',
      'Usage: node public/js/main.js [flags]',
      '',
      '  --port <n>     port to serve on              (default 8129, env RM_PORT)',
      '  --host <ip>    interface to bind             (default 127.0.0.1, env RM_HOST)',
      '  --data <path>  folder holding bookings.json  (default ./data, env RM_DATA)',
      '  --shares <f>   declared shared folders file  (default <data>/shares.json, env RM_SHARES)',
      '  --token <s>    shared token for /api/* and /mcp (env RM_TOKEN)',
      '  --quiet        no banner',
      '  --help         this text',
      '',
      'Doors:  / (the page) · /health · GET /api/resources · POST /api/resources/refresh ·',
      '        GET /api/bookings[/:id] · POST /api/book · POST /api/bookings/:id/pop · /clear ·',
      '        /mcp (rm_resources · rm_book · rm_bookings · rm_pop · rm_clear)',
    ].join('\n'),
  );
}

export async function startResourceManager(overrides: Partial<MainOptions> = {}): Promise<RunningResourceManager> {
  const options: MainOptions = { ...DEFAULTS, ...overrides };
  const dataDir = path.resolve(options.dataDir);
  const sharesFile = path.resolve(options.sharesFile || path.join(dataDir, 'shares.json'));
  const shares = loadShareList(sharesFile);
  const collect = { shares };
  const reads = (): ReturnType<typeof collectReads> => collectReads(collect);
  const refreshReads = (): ReturnType<typeof collectReads> => collectReads({ ...collect, force: true });
  const store = createBookingStore({ dataDir, reads });
  const api = await startApiServer({
    store,
    reads,
    refreshReads,
    port: options.port,
    host: options.host,
    token: options.token,
    publicDir: path.join(process.cwd(), 'public'),
  });
  if (!options.quiet) {
    console.log(`resource-manager — the register · http://${api.url.replace(/^http:\/\//, '')}`);
    console.log(`  register  ${store.dataFile} — ${store.active().length} active booking(s)`);
    console.log(`  shares    ${sharesFile}${shares.length ? ` — ${shares.length} declared` : ' — none declared (create it to list Hydra shared folders)'}`);
    console.log('  page      /        — the machine, the register, the book form');
    console.log('  api       GET /api/resources · POST /api/book · POST /api/bookings/:id/pop|clear · GET /api/bookings');
    console.log('  agent     POST /mcp — rm_resources · rm_book · rm_bookings · rm_pop · rm_clear');
    console.log('  note      it never locks and never enforces — it only won\'t allow double booking (voluntary all the way)');
  }
  return {
    store,
    api,
    options,
    stop: async () => {
      await api.stop();
    },
  };
}

async function main(): Promise<void> {
  const { options, help } = parseArgs(process.argv.slice(2));
  if (help) {
    printHelp();
    return;
  }
  const running = await startResourceManager(options);
  const shutdown = async () => {
    await running.stop();
    // Never process.exit() while undici sockets are closing (libuv assertion on Windows,
    // intermittent). Let Node drain; this unref'd fallback only fires if something lingers.
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

const isDirect = (() => {
  try {
    const entry = process.argv[1];
    return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
})();
if (isDirect) void main();

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };

  const plain = parseArgs([]);
  ok('defaults: port 8129 · ./data · localhost', plain.options.port === 8129 && plain.options.dataDir === './data' && plain.options.host === '127.0.0.1' && plain.options.token === null);

  const flagged = parseArgs(['--port', '9001', '--data', 'C:/tmp/rm', '--token', 'sek', '--quiet']);
  ok('flags carry', flagged.options.port === 9001 && flagged.options.dataDir === 'C:/tmp/rm' && flagged.options.token === 'sek' && flagged.options.quiet === true);

  const fromEnv = parseArgs([], { RM_PORT: '9100', RM_DATA: 'C:/e', RM_TOKEN: 'envtok' } as NodeJS.ProcessEnv);
  ok('environment carries', fromEnv.options.port === 9100 && fromEnv.options.dataDir === 'C:/e' && fromEnv.options.token === 'envtok');

  const override = parseArgs(['--port', '9200'], { RM_PORT: '9100' } as NodeJS.ProcessEnv);
  ok('a flag beats the environment', override.options.port === 9200);

  const junk = parseArgs(['--port', 'abc', '--nope'], {});
  ok('junk falls back to defaults', junk.options.port === 8129 && junk.help === false);
  const help = parseArgs(['--help']);
  ok('--help is recognized', help.help === true);

  // a real boot on a real port with a real data folder
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-main-'));
  const running = await startResourceManager({ port: 0, dataDir: dir, quiet: true });
  const health = (await (await fetch(running.api.url + '/health')).json()) as { ok: boolean; module: string };
  ok('startResourceManager boots for real', health.ok === true && health.module === 'resource-manager', JSON.stringify(health));
  ok('the boot prints where its register lives', running.store.dataFile.startsWith(dir));
  await running.stop();
  let closed = false;
  try {
    await fetch(running.api.url + '/health');
  } catch {
    closed = true;
  }
  ok('stop closes the door', closed);

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[main] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}

// runTests();
