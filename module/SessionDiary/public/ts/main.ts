#!/usr/bin/env node
/**
 * @module main
 * @description Boot the door: build the site, serve it, expose the API. One process, no daemon.
 *
 *   node public/js/main.js                 build, then serve on 127.0.0.1:8134
 *   node public/js/main.js --once          build the site and exit (no server)
 *   node public/js/main.js --scan 60       rebuild every 60 s while serving
 *
 * Point it at another store with --db, put the site elsewhere with --site.
 */

import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Site } from './site.js';
import { Actions } from './actions.js';
import { startApiServer } from './apiServer.js';

const MODULE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function hermesHome(): string {
  const local = process.env.LOCALAPPDATA;
  if (local) return path.join(local, 'hermes');
  return path.join(os.homedir(), '.hermes');
}

export interface MainOptions {
  port: number;
  host: string;
  dbPath: string;
  siteDir: string;
  dataDir: string;
  hermesBin: string;
  timeoutMs: number;
  model: string;
  watchSeconds: number;
  buildOnBoot: boolean;
  once: boolean;
  quiet: boolean;
}

export function parseArgs(argv: string[], env = process.env, moduleDir = MODULE_DIR): MainOptions {
  const defaults: MainOptions = {
    port: Number(env.SESSIONDIARY_PORT ?? 8134) || 8134,
    host: env.SESSIONDIARY_HOST?.trim() || '127.0.0.1',
    dbPath: env.SESSIONDIARY_DB?.trim() || path.join(hermesHome(), 'state.db'),
    siteDir: env.SESSIONDIARY_SITE?.trim() || path.join(moduleDir, 'site'),
    dataDir: env.SESSIONDIARY_DATA?.trim() || path.join(moduleDir, 'data'),
    hermesBin: env.SESSIONDIARY_HERMES?.trim() || 'hermes',
    timeoutMs: Number(env.SESSIONDIARY_TIMEOUT_MS ?? 240000) || 240000,
    model: env.SESSIONDIARY_MODEL?.trim() || 'deepseek-flash',
    watchSeconds: 0,
    buildOnBoot: true,
    once: false,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => String(argv[i + 1] ?? '');
    if (arg === '--help' || arg === '-h') {
      defaults.once = true;
      defaults.quiet = false;
      printHelp(defaults);
      process.exit(0);
    } else if (arg === '--port') {
      defaults.port = Number.parseInt(next(), 10) || defaults.port;
      i++;
    } else if (arg === '--host') {
      defaults.host = next().trim() || defaults.host;
      i++;
    } else if (arg === '--db') {
      defaults.dbPath = next().trim() || defaults.dbPath;
      i++;
    } else if (arg === '--site') {
      defaults.siteDir = next().trim() || defaults.siteDir;
      i++;
    } else if (arg === '--data') {
      defaults.dataDir = next().trim() || defaults.dataDir;
      i++;
    } else if (arg === '--hermes') {
      defaults.hermesBin = next().trim() || defaults.hermesBin;
      i++;
    } else if (arg === '--timeout') {
      defaults.timeoutMs = (Number.parseInt(next(), 10) || 240) * 1000;
      i++;
    } else if (arg === '--model') {
      defaults.model = next().trim() || defaults.model;
      i++;
    } else if (arg === '--scan') {
      defaults.watchSeconds = Math.max(0, Number.parseInt(next(), 10) || 0);
      i++;
    } else if (arg === '--once') {
      defaults.once = true;
    } else if (arg === '--no-build') {
      defaults.buildOnBoot = false;
    } else if (arg === '--quiet') {
      defaults.quiet = true;
    }
  }
  return defaults;
}

function printHelp(options: MainOptions): void {
  process.stdout.write(
    [
      'SessionDiary — Hermes Agent session wrapper',
      '',
      '  node public/js/main.js [options]',
      '',
      '  --port N        API + site port (default 8134)',
      '  --host H        bind host (default 127.0.0.1)',
      '  --db PATH       state.db to read (default ' + path.join('…', 'hermes', 'state.db') + ')',
      '  --site DIR      where the static site is written',
      '  --data DIR      diaries.json, seances, backups',
      '  --hermes BIN    hermes executable used for diary/ask (default hermes)',
      '  --timeout SEC   per-LLM-call timeout (default 240)',
      '  --model NAME    model recorded on diaries (default deepseek-flash)',
      '  --scan SEC      rebuild the site every SEC seconds while serving',
      '  --once          build and exit',
      '  --no-build      serve whatever is on disk without rebuilding',
      '  --quiet         no banner',
      '',
      `  db:   ${options.dbPath}`,
      `  site: ${options.siteDir}`,
      '',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const site = new Site({
    dbPath: options.dbPath,
    siteDir: options.siteDir,
    dataDir: options.dataDir,
    apiBase: `http://${options.host}:${options.port}`,
  });
  const actions = new Actions({
    dbPath: options.dbPath,
    dataDir: options.dataDir,
    hermesBin: options.hermesBin,
    timeoutMs: options.timeoutMs,
    model: options.model,
  });

  if (options.buildOnBoot) {
    const report = site.build();
    if (!options.quiet) {
      process.stdout.write(
        `[sessiondiary] built ${report.sessions} session pages (${report.withDiary} with prose diaries, ${
          report.seances
        } seances) in ${report.ms} ms\n[sessiondiary] index: ${site.indexFile()}\n`,
      );
    }
  }

  if (options.once) {
    process.stdout.write(`${site.indexFile()}\n`);
    return;
  }

  const api = await startApiServer({
    site,
    actions,
    dbPath: options.dbPath,
    port: options.port,
    host: options.host,
  });

  if (!options.quiet) {
    process.stdout.write(
      [
        `[sessiondiary] door up: ${api.url}`,
        `[sessiondiary] site:   ${api.url}/site/read_dir_indexer.html`,
        `[sessiondiary] file:   ${site.indexFile()}`,
        `[sessiondiary] db:     ${options.dbPath} (read-only)`,
        `[sessiondiary] hermes: ${options.hermesBin} chat --query-file … --oneshot -Q`,
        '',
      ].join('\n'),
    );
  }

  if (options.watchSeconds > 0) {
    setInterval(() => {
      try {
        const report = site.build();
        process.stdout.write(`[sessiondiary] rebuilt ${report.sessions} pages in ${report.ms} ms\n`);
      } catch (error) {
        process.stderr.write(`[sessiondiary] rebuild failed: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }, options.watchSeconds * 1000).unref();
  }

  const shutdown = (): void => {
    void api.stop().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url).replace(/\\/g, '/').endsWith(process.argv[1].replace(/\\/g, '/'));
if (invokedDirectly) {
  main().catch((error: unknown) => {
    process.stderr.write(`[sessiondiary] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  });
}
