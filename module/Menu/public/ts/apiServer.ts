/**
 * @module apiServer
 * @description The menu's one door: the tree page, the advert and inputs pages (the maker's own
 *              HTML, framed), and the three calls the inputs form needs — book a job, read it,
 *              cancel it — passed to the Scheduler. Nothing is spawned here and nothing is
 *              stored: this door lays out what Services declares and asks the Scheduler to act.
 * @intent One origin for the page, so the browser never has to be told about three ports and
 *         never has to be given CORS. Menu talks to Services and Scheduler on loopback only.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchRows, type MenuRow } from './catalog.js';
import { readModels, readNodeConfig } from './models.js';
import { renderAdvert, renderInputs, renderNotice } from './page.js';

// --- Interface Definitions ---

/** public/ — the static page lives here, so a page edit needs no build and no restart. */
const PUBLIC_DIR = path.resolve(fileURLToPath(new URL('../..', import.meta.url)), 'public');

export interface MenuApiOptions {
  port: number;
  host: string;
  servicesUrl: string;
  schedulerUrl: string;
  /** How long a catalog read is reused, ms. The tree may not be stale. */
  cacheMs?: number;
  /** The instance layer: where THIS node keeps its weights. */
  nodeFile?: string;
  /** Sizes seen last time, so the pane can draw before the disk answers. */
  cacheFile?: string;
}

export interface RunningMenuApi {
  server: http.Server;
  url: string;
  port: number;
  stop(): Promise<void>;
}

/** A catalog read, kept for a moment so a hover-swap does not re-read four files each time. */
interface Cache {
  at: number;
  rows: MenuRow[];
  error: string | null;
}

// --- Function Definitions ---

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body, null, 2));
}

function sendHtml(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

/** A polite upstream: bounded time, and the failure is the answer rather than an exception. */
async function upstream(
  url: string,
  init: { method?: string; body?: string; timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; text: string }> {
  try {
    const res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: init.body ? { 'content-type': 'application/json' } : undefined,
      body: init.body,
      signal: AbortSignal.timeout(init.timeoutMs ?? 8000),
    });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } catch (e) {
    return { ok: false, status: 0, text: e instanceof Error ? e.message : String(e) };
  }
}

/** Pass an upstream answer through — and when the upstream is DOWN, say that in JSON. */
function relay(res: http.ServerResponse, out: { ok: boolean; status: number; text: string }, where: string): void {
  if (out.status === 0) {
    sendJson(res, 502, {
      error: { code: 'upstream_down', message: `the Scheduler is not answering at ${where} (${out.text})` },
    });
    return;
  }
  res.writeHead(out.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(out.text || '{}');
}

export async function startApiServer(options: MenuApiOptions): Promise<RunningMenuApi> {
  const servicesUrl = options.servicesUrl.replace(/\/+$/, '');
  const schedulerUrl = options.schedulerUrl.replace(/\/+$/, '');
  const cacheMs = options.cacheMs ?? 2000;
  let cache: Cache | null = null;
  const nodeFile = options.nodeFile ?? path.resolve('data/node.json');
  const modelsCacheFile = options.cacheFile ?? path.resolve('data/models-cache.json');

  const readCatalog = async (force = false): Promise<Cache> => {
    if (!force && cache && Date.now() - cache.at < cacheMs) return cache;
    const out = await fetchRows({ servicesUrl });
    cache = { at: Date.now(), rows: out.rows, error: out.error };
    return cache;
  };

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://${options.host}`);
      const p = url.pathname;
      const method = req.method ?? 'GET';

      if (method === 'GET' && (p === '/' || p === '/index.html')) {
        // THE TREE IS A STATIC PAGE: it fetches /api/menu itself. Editing it is a file edit —
        // no esbuild, no tsc, no door restart, no wrapper rebuild.
        let page: string;
        try {
          page = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
        } catch {
          sendHtml(res, 500, renderNotice('the page is missing', `expected ${path.join(PUBLIC_DIR, 'index.html')} — the door is up, but there is nothing on /`));
          return;
        }
        sendHtml(res, 200, page);
        return;
      }

      if (method === 'GET' && p === '/health') {
        // A health check answers NOW: it reports what the door is, not whether an upstream is
        // slow. The catalog counts are the last read, and say so when there has not been one.
        sendJson(res, 200, {
          ok: true,
          module: 'menu',
          servicesUrl,
          schedulerUrl,
          services: cache ? cache.rows.filter((r) => r.ok).length : null,
          refused: cache ? cache.rows.filter((r) => !r.ok).length : null,
          catalog: cache ? { readAt: new Date(cache.at).toISOString(), error: cache.error } : 'not read yet',
        });
        return;
      }

      // the page's own stamp, so a page edit reaches a window that is already open
      if (method === 'GET' && p === '/api/page-version') {
        let stamp = 'missing';
        try {
          const st = fs.statSync(path.join(PUBLIC_DIR, 'index.html'));
          stamp = `${st.size}-${Math.round(st.mtimeMs)}`;
        } catch {
          // a missing page is a stamp too: the door reports it rather than pretending
        }
        sendJson(res, 200, { ok: true, page: stamp });
        return;
      }

      if (method === 'GET' && p === '/api/menu') {
        const cat = await readCatalog(url.searchParams.get('fresh') === '1');
        sendJson(res, 200, { ok: true, error: cat.error, services: cat.rows, schedulerUrl });
        return;
      }

      if (method === 'GET' && (p.startsWith('/advert/') || p.startsWith('/inputs/'))) {
        const isAdvert = p.startsWith('/advert/');
        const name = decodeURIComponent(p.slice(isAdvert ? '/advert/'.length : '/inputs/'.length));
        if (!name) {
          sendHtml(res, 400, renderNotice('which service?', `the url was ${isAdvert ? '/advert/' : '/inputs/'} with nothing after it — pick a row from the menu`));
          return;
        }
        const row = (await readCatalog()).rows.find((r) => r.name.toLowerCase() === name.toLowerCase());
        if (!row || !row.ok) {
          sendHtml(res, 404, renderNotice(
            row ? `${row.name} was refused` : `no service called ${name}`,
            row ? `the catalog refused that file, so it has no advert and no inputs: ${row.what}` : 'the catalog lists every service this node can make — the menu shows them',
          ));
          return;
        }
        const page = await upstream(`${servicesUrl}/api/services/${encodeURIComponent(row.name)}/${isAdvert ? 'ad' : 'inputs'}`);
        if (!page.ok) {
          sendHtml(res, 502, renderNotice(
            `the ${isAdvert ? 'advert' : 'inputs'} page did not come back`,
            `the Services door could not give the ${isAdvert ? 'advert' : 'inputs'} page for ${row.name}: ${page.text.slice(0, 160)}`,
          ));
          return;
        }
        sendHtml(res, 200, isAdvert
          ? renderAdvert(row, page.text, { schedulerUrl }, url.searchParams.get('embed') === '1')
          : renderInputs(row, page.text, { schedulerUrl }, url.searchParams.get('embed') === '1'));
        return;
      }

      // --- the three calls the inputs form makes: book · read · cancel ---
      if (method === 'POST' && p === '/api/run') {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const raw = Buffer.concat(chunks).toString('utf8').trim() || '{}';
        const out = await upstream(`${schedulerUrl}/api/jobs`, { method: 'POST', body: raw });
        relay(res, out, schedulerUrl);
        return;
      }

      if (method === 'GET' && (p === '/api/jobs' || p.startsWith('/api/jobs/'))) {
        const out = await upstream(schedulerUrl + p + (url.search || ''));
        relay(res, out, schedulerUrl);
        return;
      }

      if (method === 'POST' && p.startsWith('/api/jobs/') && p.endsWith('/cancel')) {
        const out = await upstream(schedulerUrl + p, { method: 'POST', body: '{}' });
        relay(res, out, schedulerUrl);
        return;
      }

      // --- the model chooser: remembered sizes now, then the disk says what changed ---
      if (method === 'GET' && p.startsWith('/api/models/')) {
        const name = decodeURIComponent(p.slice('/api/models/'.length));
        const row = (await readCatalog()).rows.find((r) => r.name.toLowerCase() === name.toLowerCase());
        if (!row || !row.ok) {
          sendJson(res, 404, { error: { code: 'no_such_service', message: row ? `${row.name} was refused by the catalog` : `no service called ${name}` } });
          return;
        }
        const out = readModels({
          service: row.name,
          declared: row.models,
          node: readNodeConfig(nodeFile),
          cacheFile: modelsCacheFile,
          verify: url.searchParams.get('verify') === '1',
        });
        sendJson(res, 200, out);
        return;
      }

      // --- what this service has done lately, so "how long did it take" is a fact ---
      if (method === 'GET' && p.startsWith('/api/runs/')) {
        const name = decodeURIComponent(p.slice('/api/runs/'.length));
        const out = await upstream(`${schedulerUrl}/api/jobs?limit=60`);
        if (!out.ok) {
          relay(res, out, schedulerUrl);
          return;
        }
        let body: { jobs?: Record<string, unknown>[] } = {};
        try {
          body = JSON.parse(out.text) as { jobs?: Record<string, unknown>[] };
        } catch {
          sendJson(res, 502, { error: { code: 'bad_upstream', message: 'the Scheduler answered with something that is not JSON' } });
          return;
        }
        const runs = (body.jobs ?? [])
          .filter((j) => String(j.service ?? '').toLowerCase() === name.toLowerCase())
          .slice(0, 5)
          .map((j) => {
            const started = j.startedAt ? Date.parse(String(j.startedAt)) : null;
            const finished = j.finishedAt ? Date.parse(String(j.finishedAt)) : null;
            const inputs = (j.inputs ?? {}) as Record<string, unknown>;
            const result = (j.result ?? null) as Record<string, unknown> | null;
            return {
              id: j.id,
              status: j.status,
              service: j.service,
              model: typeof inputs.model === 'string' ? inputs.model : null,
              at: j.startedAt ?? j.createdAt ?? null,
              ms: started && finished ? finished - started : null,
              runner: j.runner ?? null,
              executed: result ? result.executed === true : null,
              outputs: Array.isArray(result?.outputs) ? result?.outputs : [],
            };
          });
        sendJson(res, 200, { ok: true, service: name, runs });
        return;
      }

      // --- is the GPU free? the only place the queue is allowed to show itself ---
      if (method === 'GET' && p === '/api/gpu') {
        const out = await upstream(`${schedulerUrl}/api/queue`);
        if (!out.ok) {
          sendJson(res, 200, { ok: false, busy: null, running: null, queued: 0, error: out.text.slice(0, 200) });
          return;
        }
        let q: { running?: Record<string, unknown> | null; queued?: Record<string, unknown>[] } = {};
        try {
          q = JSON.parse(out.text) as typeof q;
        } catch {
          sendJson(res, 200, { ok: false, busy: null, running: null, queued: 0, error: 'the Scheduler answered with something that is not JSON' });
          return;
        }
        const running = q.running ?? null;
        const queued = q.queued ?? [];
        const inputs = (running?.inputs ?? {}) as Record<string, unknown>;
        sendJson(res, 200, {
          ok: true,
          busy: !!running || queued.length > 0,
          running: running
            ? {
                id: running.id,
                service: running.service,
                model: typeof inputs.model === 'string' ? inputs.model : null,
                startedAt: running.startedAt ?? null,
                elapsedMs: running.startedAt ? Date.now() - Date.parse(String(running.startedAt)) : null,
              }
            : null,
          queued: queued.length,
          rule: 'one job per GPU',
        });
        return;
      }

      sendJson(res, 404, {
        error: {
          code: 'no_route',
          message: `nothing at ${method} ${p} — the routes are / (the tree), /api/menu, /advert/:name, `
            + '/inputs/:name, /api/models/:name, /api/runs/:name, /api/gpu, POST /api/run, /api/jobs, '
            + '/api/jobs/:id, POST /api/jobs/:id/cancel and /health',
        },
      });
    })().catch((err: unknown) => {
      try {
        sendJson(res, 500, { error: { code: 'internal', message: err instanceof Error ? err.message : String(err) } });
      } catch {
        /* already gone */
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : options.port;
  return {
    server,
    port,
    url: `http://${options.host}:${port}`,
    stop: () => new Promise<void>((resolve) => { server.close(() => resolve()); }),
  };
}
