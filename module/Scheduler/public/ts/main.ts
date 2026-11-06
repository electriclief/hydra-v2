/**
 * @module main
 * @description Boot: the scheduler door on 8132 — the book of jobs (data/jobs.json), one slot
 *              at a time, and the dummy runner that keeps the wiring honest. Flags >
 *              environment (SCHEDULER_*) > defaults; `--help` prints what this box is.
 * @intent The door runs the moment it starts. It books, it never invents: a job is what a
 *         caller asked for, and "done" from the dummy says plainly that nothing ran.
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Scheduler, createDummyRunner } from './scheduler.js';
import { createLocalRunner } from './runner-local.js';
import { startApiServer } from './apiServer.js';
import { refFromNodeJson, startPublisher } from './publish.js';

// --- Interface Definitions ---

export interface MainOptions {
  port: number;
  host: string;
  /** The book. null = in memory (a test boot). */
  file: string | null;
  /** How many may run at once. The box says one. */
  concurrency: number;
  quiet: boolean;
  /** 'dummy' records and does nothing; 'local' actually runs the graph on this node. */
  runner: 'dummy' | 'local';
  /** Where a local job's own folder is created. */
  dataRoot: string;
}

export interface RunningScheduler {
  scheduler: Scheduler;
  api: Awaited<ReturnType<typeof startApiServer>>;
  options: MainOptions;
  stop(): Promise<void>;
}

export const DEFAULTS: MainOptions = {
  port: 8132,
  host: '127.0.0.1',
  file: path.join(process.cwd(), 'data', 'jobs.json'),
  concurrency: 1,
  quiet: false,
  runner: 'dummy',
  dataRoot: 'C:/AI/hydra-local/data/jobs',
};

// --- Function Definitions ---

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): { options: MainOptions; help: boolean } {
  const options: MainOptions = { ...DEFAULTS };
  const envPort = Number.parseInt((env.SCHEDULER_PORT ?? '').trim(), 10);
  if (Number.isFinite(envPort) && envPort > 0) options.port = envPort;
  options.host = (env.HOST ?? '').trim() || (env.SCHEDULER_HOST ?? '').trim() || options.host;
  const envFile = (env.SCHEDULER_FILE ?? '').trim();
  if (envFile) options.file = envFile;
  const envRunner = (env.SCHEDULER_RUNNER ?? '').trim().toLowerCase();
  if (envRunner === 'local' || envRunner === 'dummy') options.runner = envRunner;
  const envData = (env.SCHEDULER_DATA_ROOT ?? '').trim();
  if (envData) options.dataRoot = envData;

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
    } else if (arg === '--file') {
      options.file = next().trim() || null;
      i++;
    } else if (arg === '--memory') {
      options.file = null;
      i++;
    } else if (arg === '--concurrency') {
      const n = Number.parseInt(next(), 10);
      if (Number.isFinite(n) && n > 0) options.concurrency = n;
      i++;
    } else if (arg === '--quiet' || arg === '-q') options.quiet = true;
    else if (arg === '--runner') {
      const kind = next().trim().toLowerCase();
      if (kind === 'local' || kind === 'dummy') options.runner = kind;
      i++;
    } else if (arg === '--data-root') {
      options.dataRoot = next().trim() || options.dataRoot;
      i++;
    }
  }
  return { options, help };
}

export function printHelp(): void {
  console.log(
    [
      'scheduler — the book of jobs, one at a time (the runner is a dummy today)',
      '',
      'Usage: node public/js/main.js [flags]',
      '',
      '  --port <n>         port to serve on        (default 8132, env SCHEDULER_PORT)',
      '  --host <ip>        interface to bind       (default 127.0.0.1, env SCHEDULER_HOST)',
      '  --file <path>      the book                (default ./data/jobs.json, env SCHEDULER_FILE)',
      '  --memory           keep the book in RAM only',
      '  --concurrency <n>  jobs at once            (default 1 — one GPU, one job)',
      '  --quiet            no banner',
      '  --help             this text',
      '',
      'Doors:  / (the book) · /health · /api/queue · /api/stats · GET|POST /api/jobs ·',
      '        GET /api/jobs/:id · POST /api/jobs/:id/cancel ·',
      '        /mcp (scheduler_submit · scheduler_jobs · scheduler_status)',
      '',
      'The runner is a DUMMY: it records the job and executes nothing. That is deliberate — the',
      'wiring (submit · queue · run · status) is real, so a real runner replaces one file.',
    ].join('\n'),
  );
}

export async function startScheduler(overrides: Partial<MainOptions> = {}): Promise<RunningScheduler> {
  const options: MainOptions = { ...DEFAULTS, ...overrides };
  if (options.file) options.file = path.resolve(options.file);
  const runner = options.runner === 'local'
    ? createLocalRunner({ dataRoot: options.dataRoot, log: (line) => { if (!options.quiet) console.log(line); } })
    : createDummyRunner();
  const scheduler = new Scheduler({
    file: options.file,
    concurrency: options.concurrency,
    runner,
  });
  // public/js/main.js -> public/js -> public -> Scheduler -> module (where Menu/ and Core/ live)
  const moduleRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..');
  // The status line's inputs: this node's name, and the standby guard's report when this node has one. A node
  // that does not mine has no file, and the line says "no standby report" rather than inventing a miner.
  const nodeRef = process.env.SCHEDULER_REF ?? refFromNodeJson(moduleRoot) ?? 'scheduler';
  const standbyFile = path.resolve(moduleRoot, '..', 'data', 'standby', 'guard.state.json');
  const api = await startApiServer({
    scheduler,
    port: options.port,
    host: options.host,
    ref: nodeRef,
    standbyFile,
    // the footer reads the same surface a peer would: this node's State, not a private file
    stateUrl: process.env.SCHEDULER_STATE_URL ?? 'http://127.0.0.1:8127',
  });

  // the book, published: a booking nobody else can see is a private note, not a LAN booking
  const publisher = startPublisher(
    {
      stateUrl: process.env.SCHEDULER_STATE_URL ?? 'http://127.0.0.1:8127',
      ref: nodeRef,
      intervalMs: Number(process.env.SCHEDULER_PUBLISH_MS ?? 5000),
      root: moduleRoot,
    },
    () => scheduler.list({ limit: 200 }),
    () => scheduler.stats(),
    (line) => { if (!options.quiet) console.log(line); },
  );
  if (!options.quiet) {
    const stats = scheduler.stats();
    console.log(`scheduler — ${scheduler.describe()} · ${api.url}`);
    console.log(`  book      ${options.file ?? 'in memory only'} — ${stats.total} job(s)`);
    console.log('  page      /  — the book, newest first');
    console.log('  api       POST /api/jobs {service, inputs, note} · GET /api/jobs · GET /api/jobs/:id · POST /api/jobs/:id/cancel · /api/queue · /api/stats');
    console.log('  agent     POST /mcp — scheduler_submit · scheduler_jobs · scheduler_status');
    console.log('  runner    DUMMY — it executes nothing, and says so. A real runner replaces createDummyRunner().');
  }
  return {
    scheduler,
    api,
    options,
    stop: async () => {
      publisher.stop();
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
  const running = await startScheduler(options);
  const shutdown = async () => {
    await running.stop();
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
