/**
 * @module staticFiles
 * @description Serves the `public/` folder over the same port as the API — the GUI, its
 *              stylesheet and its compiled script.
 * @intent The wrapper is one box with one port: the API answers /api/*, and everything else
 *         is the human face. This module is the smallest honest file server for that: a MIME
 *         map, an index fallback, a traversal guard, and a 404 that explains where the API
 *         went instead of pretending the file exists.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

// --- Interface Definitions ---

export interface StaticOptions {
  /** Directory to serve from (default: ./public relative to the process cwd). */
  root?: string;
  /** Serve this file for `/` and for a directory miss (default index.html). */
  index?: string;
  /** Cache-Control for served files (default 'no-cache' — the GUI is code, not content). */
  cacheControl?: string;
}

export interface StaticResult {
  /** What happened, for tests and logs: served | not-found | forbidden | not-a-file. */
  status: 'served' | 'not-found' | 'forbidden' | 'not-a-file';
  path: string;
  contentType?: string;
  bytes?: number;
}

// --- Function Definitions ---

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

/** The content type for a path, by extension. */
export function contentTypeFor(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/** URL path → an absolute file path inside the root, or null when it escapes the root. */
export function resolveInside(root: string, urlPath: string): string | null {
  let decoded = urlPath;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const rootAbs = path.resolve(root);
  const target = path.resolve(rootAbs, '.' + (decoded.startsWith('/') ? decoded : '/' + decoded));
  if (target !== rootAbs && !target.startsWith(rootAbs + path.sep)) return null;
  return target;
}

/** Serve one request from a root directory. Writes to the response either way. */
export function serveStatic(req: IncomingMessage, res: ServerResponse, options: StaticOptions = {}): StaticResult {
  const root = options.root ?? path.join(process.cwd(), 'public');
  const index = options.index ?? 'index.html';
  const raw = (req.url || '/').split('?')[0].split('#')[0];
  const resolved = resolveInside(root, raw === '' ? '/' : raw);

  const finish = (status: StaticResult['status'], filePath: string, body?: string, type?: string): StaticResult => {
    if (status === 'served') return { status, path: filePath, contentType: type, bytes: body ? Buffer.byteLength(body) : 0 };
    res.writeHead(status === 'forbidden' ? 403 : 404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(body ?? `${status}: ${raw}\n`);
    return { status, path: filePath };
  };

  if (!resolved) {
    return finish('forbidden', raw, `forbidden: ${raw} — that path is outside the served folder\n`);
  }

  let filePath = resolved;
  try {
    let stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, index);
      stat = fs.statSync(filePath);
    }
    if (!stat.isFile()) return finish('not-a-file', filePath, `not a file: ${raw}\n`);
    const body = fs.readFileSync(filePath);
    res.writeHead(200, {
      'content-type': contentTypeFor(filePath),
      'content-length': body.length,
      'cache-control': options.cacheControl ?? 'no-cache',
    });
    res.end(body);
    return { status: 'served', path: filePath, contentType: contentTypeFor(filePath), bytes: body.length };
  } catch {
    if (raw === '/' || raw === '') {
      return finish(
        'not-found',
        path.join(root, index),
        `no GUI here yet — expected ${path.join(root, index)}.\nThe API is alive: GET /health, /api/processes, POST /mcp\n`,
      );
    }
    return finish('not-found', filePath, `not found: ${raw}\nAPI: /health · /api/processes · /api/commands · MCP: POST /mcp\n`);
  }
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const http = await import('node:http');
  const os = await import('node:os');
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };

  // 1. pure helpers
  ok('content type by extension', contentTypeFor('/x/gui.css').startsWith('text/css'), contentTypeFor('/x/gui.css'));
  ok('html content type', contentTypeFor('index.html').startsWith('text/html'));
  ok('unknown extension is octet-stream', contentTypeFor('blob.weird') === 'application/octet-stream');
  const root = path.join(os.tmpdir(), 'pw-static-root');
  ok('a normal path resolves inside', resolveInside(root, '/js/gui.js') !== null);
  ok('a traversal is refused', resolveInside(root, '/../secrets.txt') === null, String(resolveInside(root, '/../secrets.txt')));
  ok('an encoded traversal is refused', resolveInside(root, '/%2e%2e/secrets.txt') === null);
  ok('an encoded backslash traversal is refused', resolveInside(root, '/..%5Csecrets.txt') === null);
  ok('a null byte is refused', resolveInside(root, '/a%00b.txt') === null);

  // 2. a real server over a real folder
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-static-'));
  fs.mkdirSync(path.join(dir, 'css'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'js'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>GUI</title><h1>ProcessWrapper</h1>');
  fs.writeFileSync(path.join(dir, 'css', 'gui.css'), 'body{color:red}');
  fs.writeFileSync(path.join(dir, 'js', 'gui.js'), 'console.log("gui")');
  fs.writeFileSync(path.join(os.tmpdir(), 'pw-static-secret.txt'), 'TOP SECRET');

  const server = http.createServer((req, res) => {
    serveStatic(req, res, { root: dir });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const index = await fetch(base + '/');
    const indexText = await index.text();
    ok('the root serves the index', index.status === 200 && indexText.includes('ProcessWrapper'), String(index.status));
    ok('the index is served as html', (index.headers.get('content-type') || '').startsWith('text/html'), String(index.headers.get('content-type')));
    ok('the index is not cached', index.headers.get('cache-control') === 'no-cache', String(index.headers.get('cache-control')));
    const css = await fetch(base + '/css/gui.css');
    ok('a stylesheet is served with its type', css.status === 200 && (css.headers.get('content-type') || '').startsWith('text/css'), String(css.headers.get('content-type')));
    const js = await fetch(base + '/js/gui.js');
    ok('a script is served as javascript', js.status === 200 && (js.headers.get('content-type') || '').includes('javascript'), String(js.headers.get('content-type')));
    const withQuery = await fetch(base + '/css/gui.css?v=2');
    ok('a query string is ignored', withQuery.status === 200 && (await withQuery.text()).includes('color:red'));
    const missing = await fetch(base + '/nope.txt');
    const missingText = await missing.text();
    ok('a missing file is a 404 that points at the API', missing.status === 404 && missingText.includes('/health'), missingText.trim());
    const traversal = await fetch(base + '/../pw-static-secret.txt');
    const traversalText = await traversal.text();
    ok('a traversal is forbidden, never served', traversalText !== 'TOP SECRET' && traversal.status >= 400, `${traversal.status} ${traversalText.trim()}`);
    ok('the secret really exists outside the root', fs.readFileSync(path.join(os.tmpdir(), 'pw-static-secret.txt'), 'utf8') === 'TOP SECRET');
    const dirUrl = await fetch(base + '/css/');
    ok('a directory falls back to the index lookup (404 here, no listing)', dirUrl.status === 404, String(dirUrl.status));

    // 3. the helper answers the same way as the served server
    const fakeRes = {
      status: 0,
      headers: {} as Record<string, string>,
      body: '',
      writeHead(code: number, headers: Record<string, string>) {
        this.status = code;
        this.headers = headers;
      },
      end(body?: string | Buffer) {
        this.body = body ? String(body) : '';
      },
    };
    const result = serveStatic({ url: '/' } as never, fakeRes as never, { root: dir });
    ok('the helper reports what it served', result.status === 'served' && result.contentType?.startsWith('text/html') === true, JSON.stringify(result));
    ok('the helper wrote a 200', fakeRes.status === 200, String(fakeRes.status));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeAllConnections?.();
  }

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[staticFiles] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}

// runTests();
