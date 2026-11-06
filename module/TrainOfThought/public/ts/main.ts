/**
 * Train Of Thought — the door. `node public/js/main.js` starts it on 127.0.0.1:8135.
 *
 *   node public/js/main.js                 # serve
 *   node public/js/main.js --port 8135     # explicit port
 *   node public/js/main.js --data <dir>    # a different thoughts.json (tests, a second train set)
 *   node public/js/main.js --once          # print the state and exit (no listening socket)
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ThoughtStore } from './store.js';
import { createServer } from './apiServer.js';

const MODULE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface MainOptions {
  port: number;
  host: string;
  dataDir: string;
  sessionBase: string;
  once: boolean;
}

export function parseArgs(argv: string[], moduleDir = MODULE_DIR): MainOptions {
  const options: MainOptions = {
    port: 8135,
    host: '127.0.0.1',
    dataDir: path.join(moduleDir, 'data'),
    sessionBase: process.env.TOT_SESSIONS ?? 'http://127.0.0.1:8134',
    once: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string => String(argv[i + 1] ?? '');
    if (arg === '--port') {
      options.port = Number.parseInt(next(), 10) || options.port;
      i += 1;
    } else if (arg === '--host') {
      options.host = next() || options.host;
      i += 1;
    } else if (arg === '--sessions') {
      options.sessionBase = next() || options.sessionBase;
      i += 1;
    } else if (arg === '--data') {
      options.dataDir = path.resolve(next());
      i += 1;
    } else if (arg === '--once') {
      options.once = true;
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Train Of Thought — the long-term intention DAG',
          '',
          '  node public/js/main.js [options]',
          '',
          '  --port N     port (default 8135)',
          '  --host H     bind host (default 127.0.0.1)',
          '  --data DIR   thoughts.json lives here (default <module>/data)',
          '  --sessions B base url of the session manager (default http://127.0.0.1:8134, optional)',
          '  --once       print the frontier and exit',
          '',
        ].join('\n'),
      );
      process.exit(0);
    }
  }
  return options;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const store = new ThoughtStore({ file: path.join(options.dataDir, 'thoughts.json') });

  if (options.once) {
    const ready = store.ready();
    process.stdout.write(
      JSON.stringify(
        {
          store: store.file,
          nodes: store.nodes.length,
          archived: store.nodes.filter((node) => node.state === 'done').length,
          frontier: ready.map((node) => ({ ref: node.ref, title: node.title, next: node.next[0] ?? null })),
        },
        null,
        2,
      ) + '\n',
    );
    return;
  }

  const server = createServer({ store, host: options.host, port: options.port });
  server.listen(options.port, options.host, () => {
    process.stdout.write(
      [
        `[trainofthought] store:  ${store.file}`,
        `[trainofthought] nodes:  ${store.nodes.length} (${store.ready().length} ready)`,
        `[trainofthought] door up: http://${options.host}:${options.port}`,
        `[trainofthought] page:   http://${options.host}:${options.port}/`,
        '',
      ].join('\n'),
    );
  });
  server.on('error', (error: NodeJS.ErrnoException) => {
    process.stderr.write(`[trainofthought] listen failed: ${error.code ?? ''} ${error.message}\n`);
    process.exit(1);
  });

  const stop = (): void => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main();
