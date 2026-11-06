/**
 * @module main
 * @description Boot: the menu door on 8133 — the tree of what this node can make, each row's
 *              advert on hover, its inputs page on click, and the booking call that turns those
 *              inputs into a Scheduler job. Flags > environment (MENU_*) > defaults.
 * @intent This door is the way IN, not the thing that runs: it reads the Services catalog, it
 *         asks the Scheduler to book, and it holds no state of its own.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startApiServer } from './apiServer.js';

// --- Interface Definitions ---

export interface MainOptions {
  port: number;
  host: string;
  servicesUrl: string;
  schedulerUrl: string;
  /** where this node says it keeps its weights — instance data, not a service file */
  nodeFile: string;
  quiet: boolean;
}

export interface RunningMenu {
  api: Awaited<ReturnType<typeof startApiServer>>;
  options: MainOptions;
  stop(): Promise<void>;
}

export const DEFAULTS: MainOptions = {
  port: 8133,
  host: '127.0.0.1',
  servicesUrl: 'http://127.0.0.1:8128',
  schedulerUrl: 'http://127.0.0.1:8132',
  nodeFile: 'data/node.json',
  quiet: false,
};

// --- Function Definitions ---

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): { options: MainOptions; help: boolean } {
  const options: MainOptions = { ...DEFAULTS };
  const envPort = Number.parseInt((env.MENU_PORT ?? '').trim(), 10);
  if (Number.isFinite(envPort) && envPort > 0) options.port = envPort;
  options.host = (env.MENU_HOST ?? '').trim() || options.host;
  options.servicesUrl = (env.MENU_SERVICES_URL ?? '').trim() || options.servicesUrl;
  options.schedulerUrl = (env.MENU_SCHEDULER_URL ?? '').trim() || options.schedulerUrl;

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
    } else if (arg === '--services') {
      options.servicesUrl = next().trim() || options.servicesUrl;
      i++;
    } else if (arg === '--scheduler') {
      options.schedulerUrl = next().trim() || options.schedulerUrl;
      i++;
    } else if (arg === '--node') {
      options.nodeFile = next().trim() || options.nodeFile;
      i++;
    } else if (arg === '--quiet' || arg === '-q') options.quiet = true;
  }
  return { options, help };
}

export function printHelp(): void {
  console.log(
    [
      'menu — the way in: the tree, each advert, each inputs page, one booking call',
      '',
      'Usage: node public/js/main.js [flags]',
      '',
      '  --port <n>       port to serve on     (default 8133, env MENU_PORT)',
      '  --host <ip>      interface to bind    (default 127.0.0.1, env MENU_HOST)',
      '  --services <url> the Services door    (default http://127.0.0.1:8128, env MENU_SERVICES_URL)',
      '  --scheduler <url> the Scheduler door  (default http://127.0.0.1:8132, env MENU_SCHEDULER_URL)',
      '  --node <file>    instance data: where the weights live (default data/node.json)',
      '  --quiet          no banner',
      '  --help           this text',
      '',
      'Doors:  / (the tree) · /advert/:name · /inputs/:name · /api/menu · POST /api/run ·',
      '        /api/jobs · /api/jobs/:id · POST /api/jobs/:id/cancel · /health',
      '',
      'Hover (or ↑ ↓) shows a service advert on the right; a click opens its inputs page, whose',
      'form books a job on the Scheduler. This door never runs anything itself.',
    ].join('\n'),
  );
}

export async function startMenu(overrides: Partial<MainOptions> = {}): Promise<RunningMenu> {
  const options: MainOptions = { ...DEFAULTS, ...overrides };
  const api = await startApiServer({
    port: options.port,
    host: options.host,
    servicesUrl: options.servicesUrl,
    schedulerUrl: options.schedulerUrl,
    nodeFile: path.resolve(options.nodeFile),
  });
  if (!options.quiet) {
    console.log(`menu — the way in · ${api.url}`);
    console.log(`  tree      /  — a row per service, the advert beside it, inputs on click`);
    console.log(`  reads     ${options.servicesUrl} (the catalog, every request)`);
    console.log(`  books     ${options.schedulerUrl} (POST /api/jobs — one job at a time)`);
    console.log('  note      nothing runs here: the Scheduler books, and today its runner is a dummy');
  }
  return {
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
  const running = await startMenu(options);
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
