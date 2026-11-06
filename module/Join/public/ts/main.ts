/**
 * @module main
 * @description THE LOCAL THREAD — `npm start`, this module's own door on its own port.
 *              Reads flags and environment only; nothing is written back into the shelf.
 * @intent The module standard's second life: `Join_module.js` is the embed entry another
 *              code thread loads; this is the standalone one a person runs. They are
 *              different on purpose, and neither is a second implementation.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createShelf } from './shelf.js';
import { startApi } from './apiServer.js';

/** Loopback by default: this door describes a node, it does not serve the network. */
const DEFAULT_HOST = '127.0.0.1';

// --- Interface Definitions ---

export interface MainOptions {
  shelfRoot?: string;
  port?: number;
  host?: string;
  token?: string;
  dry?: boolean;
}

// --- Function Definitions ---

/** Read a flag off argv: `--key value` or `--key=value`. */
function flag(argv: readonly string[], key: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (a === `--${key}`) return argv[i + 1];
    if (a.startsWith(`--${key}=`)) return a.slice(key.length + 3);
  }
  return undefined;
}

/** Where this module sits, and therefore the shelf it describes by default. */
const HERE = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

export async function main(argv: readonly string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const opts: Required<Omit<MainOptions, 'token'>> & { token: string | undefined } = {
    shelfRoot: flag(argv, 'shelf') ?? env.JOIN_SHELF_ROOT ?? path.resolve(HERE, '..'),
    port: Number(flag(argv, 'port') ?? env.JOIN_PORT ?? 8131),
    host: flag(argv, 'host') ?? env.JOIN_HOST ?? DEFAULT_HOST,
    token: flag(argv, 'token') ?? env.JOIN_TOKEN,
    dry: (flag(argv, 'dry') ?? '') === 'true' || env.JOIN_DRY === '1',
  };

  const shelf = createShelf({
    shelfRoot: opts.shelfRoot,
    pwUrl: env.JOIN_PW_URL ?? 'http://127.0.0.1:8125',
    servicesUrl: env.JOIN_SERVICES_URL ?? 'http://127.0.0.1:8128',
    dry: opts.dry,
  });

  const { port } = await startApi({
    shelf,
    port: opts.port,
    host: opts.host ?? DEFAULT_HOST,
    ...(opts.token ? { token: opts.token } : {}),
    publicRoot: path.join(HERE, 'public'),
  });

  const decls = shelf.declarations();
  console.log(shelf.describe());
  console.log(`  shelf       ${opts.shelfRoot}`);
  console.log(`  modules     ${decls.length} (${decls.filter(d => d.missing.length === 0).length} fully declared)`);
  console.log(`  wired@boot  ${decls.filter(d => d.wiredAtBoot).map(d => d.name).join(', ') || '(none declared)'}`);
  console.log(`  door        http://${opts.host}:${port}/`);
  console.log(`  agent door  POST http://${opts.host}:${port}/mcp`);
  console.log(`  resolve     http://${opts.host}:${port}/api/resolve/State`);
  if (opts.dry) console.log('  DRY         Join will not start anything (--dry)');
  console.log('  close this window to stop it.');

  const shutdown = (): void => { process.exitCode = 0; };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Only run when this file is the entry — never when a host imports it.
if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/').replace(/^\/+/, '')}`) {
  void main();
}