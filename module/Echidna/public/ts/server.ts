/**
 * @module server
 * @description The HTTP face of Echidna: the thread, the Easy Mode declaration, and one ask at a time.
 * @intent The pane needs three things and refuses to need a fourth: what has been said, what can be tapped, and
 *         a way to ask. Everything else — state, jobs, karma — it reads from the doors that own it rather than
 *         keeping a second copy, because a second copy is a second answer.
 *
 * Routes:
 *   GET  /health                 → liveness, which agent binary, whether a session is being continued
 *   GET  /api/state              → {thread, easy, agent, speech}
 *   POST /api/say {text}         → ask the agent once; returns the two turns it wrote
 *   POST /api/monitor {kind,title,text} → put a card on the board (the card replaces the last one)
 *   POST /api/monitor/back      → walk back through the replaced cards
 *   GET|POST /api/tts           → is the voice on, and which door is speaking
 *   POST /api/speak {text,character} → audio/wav from the LAN's speech door (never synthesised here)
 *   POST /api/clear              → empty the thread (the file stays, empty)
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { ask, type AgentConfig } from './agent.js';
import { loadRig } from './rig.js';
import { ThreadStore, turnId, type Turn } from './thread.js';

export interface ServerOptions {
  port: number;
  host: string;
  publicDir: string;
  dataDir: string;
  agent: AgentConfig;
  /** Where this node publishes the conversation, so every node's pane shows the same one. */
  stateUrl: string;
  /** The ref this node publishes under, e.g. "123". */
  nodeRef: string;
  /** This node's Mirror, used to read the conversation when another node is the host. */
  mirrorUrl: string;
  /** A viewer: it serves the host's conversation and never publishes a branch of its own. */
  readOnly?: boolean;
  /** The approved rig directory (media/characters). The faces come from there, never from a second copy. */
  rigDir: string;
  /** The LAN speech door this node asks by default. */
  ttsUrl: string;
}

/** One card on the monitor. It is replaced, never appended: the board is never a feed. */
export interface MonitorCard {
  kind: 'question' | 'output' | 'goal' | 'note' | 'speaker';
  title: string;
  text: string;
  at: string;
  /** speaker only: which character record to draw, and what audio it says the line over. */
  character?: string;
  audio?: string;
  /** buttons someone can tap to answer, when the card is asking something */
  options?: string[];
}

export interface MonitorState {
  stack: MonitorCard[];
  index: number;
}

export interface EasyDeclaration {
  note?: string;
  question?: {
    id?: string;
    text: string;
    options?: string[];
    allowText?: boolean;
  } | null;
  actions?: Array<{ name: string; icon?: string; url?: string; command?: string; risk?: string }>;
  media?: Array<{ type: 'image' | 'audio' | 'video'; src: string; caption?: string }>;
  speech?: { stt?: { url: string; label?: string } | null; tts?: { url: string; label?: string } | null };
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString('utf8');
      if (data.length > 1_000_000) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/** Read the Easy Mode declaration. A broken file is reported to the pane, not hidden: the operator wrote it. */
export function readEasy(file: string): { easy: EasyDeclaration; error: string | null } {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as EasyDeclaration;
    return { easy: raw && typeof raw === 'object' ? raw : {}, error: null };
  } catch (error) {
    const message = (error as Error).message;
    if (/ENOENT/.test(message)) return { easy: {}, error: null };
    return { easy: {}, error: `easy.json is not readable: ${message}` };
  }
}

export function createServer(options: ServerOptions): http.Server {
  const thread = new ThreadStore(options.dataDir);
  const easyFile = path.join(options.dataDir, 'easy.json');
  const sessionFile = path.join(options.dataDir, 'agent.json');
  let busy = false;

  const readSession = (): string | null => {
    try {
      const j = JSON.parse(fs.readFileSync(sessionFile, 'utf8')) as { session?: string };
      return j.session ?? null;
    } catch {
      return null;
    }
  };
  const writeSession = (id: string | null): void => {
    if (!id) return;
    try {
      fs.writeFileSync(sessionFile, JSON.stringify({ session: id, at: new Date().toISOString() }, null, 2));
    } catch {
      /* a lost session id costs continuity, not correctness */
    }
  };

  // ── the monitor: a stack of cards, only ever one on screen ────────────────────────────────────────────────
  const ttsFile = path.join(options.dataDir, 'tts.json');
  const readTts = (): { enabled: boolean; url: string } => {
    try {
      const raw = JSON.parse(fs.readFileSync(ttsFile, 'utf8')) as { enabled?: boolean; url?: string };
      return { enabled: raw.enabled !== false, url: raw.url || options.ttsUrl };
    } catch {
      fs.writeFileSync(ttsFile, JSON.stringify({ enabled: true, url: options.ttsUrl }, null, 2));
      return { enabled: true, url: options.ttsUrl };
    }
  };

  const monitorFile = path.join(options.dataDir, 'monitor.json');
  let monitor: MonitorState = { stack: [], index: -1 };
  try {
    const raw = JSON.parse(fs.readFileSync(monitorFile, 'utf8')) as MonitorState;
    if (Array.isArray(raw.stack) && raw.stack.length) {
      monitor = { stack: raw.stack, index: Math.min(Math.max(0, raw.index ?? raw.stack.length - 1), raw.stack.length - 1) };
    }
  } catch {
    /* no board yet */
  }
  const saveMonitor = (): void => {
    try {
      fs.writeFileSync(monitorFile, JSON.stringify(monitor, null, 2));
    } catch {
      /* a board that cannot be written still exists in memory */
    }
  };
  const monitorCard = (): MonitorCard | null => (monitor.index >= 0 && monitor.stack[monitor.index]) || monitor.stack[monitor.stack.length - 1] || null;
  const pushCard = (card: MonitorCard): void => {
    // replacing forward: a new card is the present, so what was "ahead" is no longer reachable
    monitor.stack = monitor.stack.slice(0, monitor.index + 1);
    monitor.stack.push(card);
    if (monitor.stack.length > 40) monitor.stack.shift();
    monitor.index = monitor.stack.length - 1;
    saveMonitor();
  };

  /** Publish the conversation where every node can read it. One writer, one branch, no merging. */
  const publish = async (): Promise<void> => {
    // a viewer must not publish an empty thread over someone else's talk
    if (options.readOnly) return;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      await fetch(`${options.stateUrl.replace(/\/$/, '')}/api/state/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: `node.${options.nodeRef}.echidna`,
          content: {
            at: new Date().toISOString(),
            host: options.nodeRef,
            owner: 'echidna',
            monitor: { card: monitorCard(), index: monitor.index, total: monitor.stack.length },
            thread: thread.read(60),
          },
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
    } catch {
      /* State down: the local thread still works, and the next publish catches up */
    }
  };
  void publish();

  return http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
      const method = (req.method ?? 'GET').toUpperCase();
      const p = url.pathname;

      if (p === '/health') {
        sendJson(res, 200, {
          ok: true,
          door: 'echidna',
          agent: options.agent.bin,
          session: readSession(),
          busy,
        });
        return;
      }

      if (p === '/api/state' && method === 'GET') {
        const { easy, error } = readEasy(easyFile);
        // the faces come from the APPROVED rig, not from a second set of numbers invented here
        const rig = loadRig(options.rigDir);
        const characters = Object.keys(rig.characters).length
          ? { source: options.rigDir, error: rig.error, characters: rig.characters }
          : null;
        sendJson(res, 200, {
          tts: readTts(),
          characters,
          monitor: { card: monitorCard(), index: monitor.index, total: monitor.stack.length },
          thread: thread.read(),
          easy,
          easyError: error,
          busy,
          agent: {
            bin: options.agent.bin,
            session: readSession(),
            // honesty over optimism: the pane shows the binary it will run, so a missing one is visible before asking
            present: fs.existsSync(options.agent.bin),
            timeoutMs: options.agent.timeoutMs,
          },
        });
        return;
      }

      // GET /api/conversation?host=<ref> — the SAME talk, read from whoever hosts the agent. One writer, one branch:
      // this is why two nodes cannot disagree about what was said.
      if (p === '/api/conversation' && method === 'GET') {
        const host = (url.searchParams.get('host') || options.nodeRef).toLowerCase();
        if (host === String(options.nodeRef).toLowerCase()) {
          sendJson(res, 200, {
            ok: true,
            host,
            viewer: false,
            monitor: { card: monitorCard(), index: monitor.index, total: monitor.stack.length },
            thread: thread.read(120),
            agent: { present: fs.existsSync(options.agent.bin), busy },
          });
          return;
        }
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 4000);
          const remote = await fetch(`${options.mirrorUrl.replace(/\/$/, '')}/api/node/${encodeURIComponent(host)}`, {
            signal: controller.signal,
          });
          clearTimeout(timer);
          // Mirror answers {ok, role, node:{...}}; an older reader answered the node directly
          const body = (await remote.json().catch(() => ({}))) as {
            conversation?: Record<string, unknown>;
            node?: { conversation?: Record<string, unknown> };
          };
          const conv = body.node?.conversation ?? body.conversation;
          if (!conv) {
            sendJson(res, 404, { ok: false, error: `node ${host} is not publishing a conversation`, host });
            return;
          }
          const mon = (conv.monitor ?? {}) as Record<string, unknown>;
          sendJson(res, 200, {
            ok: true,
            host,
            viewer: true,
            monitor: mon,
            thread: Array.isArray(conv.thread) ? conv.thread : [],
            agent: { present: false, busy: false },
            publishedAt: conv.at ?? null,
          });
          return;
        } catch (error) {
          sendJson(res, 502, { ok: false, error: `could not read ${host}'s conversation: ${(error as Error).message}`, host });
          return;
        }
      }

      // The billboard: N small pages, rotated by the pane, each a bite-size chunk for a non-reader. This door only
      // composes them - it never runs a button. A page may offer actions, and an action is a declaration the pane
      // shows as a button; pressing it calls the owner's door, which is where the decision to run something lives.
      if (p === '/api/billboard' && method === 'GET') {
        const tot = (process.env.ECHIDNA_TOT ?? 'http://127.0.0.1:8135').replace(/\/$/, '');
        const phoenix = (process.env.ECHIDNA_PHOENIX ?? 'http://127.0.0.1:8146').replace(/\/$/, '');
        const j = async (url: string): Promise<any> => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 2000);
          try {
            const r = await fetch(url, { signal: controller.signal });
            clearTimeout(timer);
            return r.ok ? await r.json() : { ok: false, status: r.status };
          } catch (error) {
            clearTimeout(timer);
            return { ok: false, error: (error as Error).message };
          }
        };
        const [brief, health, entries] = await Promise.all([
          j(`${tot}/api/brief`),
          j(`${phoenix}/health`),
          j(`${phoenix}/api/entries`),
        ]);
        const pages: unknown[] = [];
        const bullets: Array<{ ref: string; state: string; title: string }> = Array.isArray(brief?.bullets) ? brief.bullets : [];
        const blocked = bullets.filter((b) => b.state === 'blocked');
        const active = bullets.filter((b) => b.state === 'active');
        const open = bullets.filter((b) => b.state === 'open');

        pages.push({
          kind: 'status',
          title: brief?.ok ? 'where the work stands' : 'the train of thought is not answering',
          lines: [
            brief?.ok ? `${bullets.length} open intentions · ${active.length} active · ${blocked.length} blocked` : `checked ${tot} · ${brief?.error ?? 'no answer'}`,
            health?.ok ? `upkeep: ${health.entries} registered · next cycle in ${Math.round((health.nextBeatInMs ?? 0) / 60000)} min` : `phoenix is not answering at ${phoenix}`,
            ...(entries?.rows ?? []).slice(0, 2).map((r: any) => `${r.id} — last ${r.last?.outcome ?? 'never run'}`),
          ],
          buttons: [],
        });

        if (active.length) {
          pages.push({
            kind: 'next',
            title: 'the next thing',
            lines: active.slice(0, 3).map((b) => `${b.ref} · ${b.title}`),
            buttons: [{ label: 'open the train of thought', action: { method: 'GET', url: `${tot}/` } }],
          });
        }

        if (blocked.length || open.length) {
          pages.push({
            kind: 'waiting',
            title: 'waiting on you',
            lines: [...blocked, ...open].slice(0, 3).map((b) => `${b.state} · ${b.title}`),
            buttons: blocked.slice(0, 1).map((b) => ({
              label: `look at ${b.ref}`,
              action: { method: 'GET', url: `${tot}/api/handoff/${b.ref}` },
            })),
          });
        }

        if (pages.length === 1) {
          pages.push({ kind: 'idle', title: 'nothing is waiting', lines: ['say what you want to do and it becomes a bullet here'], buttons: [] });
        }

        sendJson(res, 200, {
          ok: true,
          everyMs: Number(process.env.ECHIDNA_BILLBOARD_MS ?? 15000),
          count: pages.length,
          pages,
        });
        return;
      }

      // Where we left off: the Train of Thought as bullets, fetched at boot so the first thing Echidna says is the
      // state of the work rather than "hello". Bullets only - ref, state, title - about 2 KB for the whole DAG.
      // The store stays on the ToT door; this door never writes to it.
      if (p === '/api/brief' && method === 'GET') {
        const tot = (process.env.ECHIDNA_TOT ?? 'http://127.0.0.1:8135').replace(/\/$/, '');
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 2500);
          const upstream = await fetch(`${tot}/api/brief`, { signal: controller.signal });
          clearTimeout(timer);
          const data = (await upstream.json()) as { count?: number; chars?: number; text?: string; bullets?: unknown };
          sendJson(res, upstream.ok ? 200 : 502, {
            ok: upstream.ok,
            source: tot,
            count: data.count ?? 0,
            chars: data.chars ?? 0,
            text: data.text ?? '',
            bullets: data.bullets ?? [],
          });
        } catch (error) {
          sendJson(res, 503, { ok: false, source: tot, error: `the train of thought is not answering at ${tot}`, detail: (error as Error).message });
        }
        return;
      }

      // The voice: a switch and a proxy. This door never synthesises speech itself - the LAN does, so a laptop with
      // no GPU still talks, and the box doing the talking is visible as a service in the Menu.
      if (p === '/api/tts' && method === 'GET') {
        const cfg = readTts();
        let reachable = false;
        let providers: unknown = null;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 1500);
          const res = await fetch(`${cfg.url.replace(/\/$/, '')}/health`, { signal: controller.signal });
          clearTimeout(timer);
          const body = (await res.json()) as { providers?: unknown };
          reachable = res.ok;
          providers = body.providers ?? null;
        } catch {
          reachable = false;
        }
        sendJson(res, 200, { tts: { ...cfg, reachable, providers } });
        return;
      }

      if (p === '/api/tts' && method === 'POST') {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        const cfg = readTts();
        if (typeof body.enabled === 'boolean') cfg.enabled = body.enabled;
        if (typeof body.url === 'string' && body.url.trim()) cfg.url = body.url.trim();
        fs.writeFileSync(ttsFile, JSON.stringify(cfg, null, 2));
        sendJson(res, 200, { ok: true, tts: cfg });
        return;
      }

      if (p === '/api/speak' && method === 'POST') {
        const cfg = readTts();
        if (!cfg.enabled) {
          sendJson(res, 409, { ok: false, error: 'the voice is switched off' });
          return;
        }
        let body: Record<string, unknown>;
        try {
          body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        const text = String(body.text ?? '').trim();
        if (!text) {
          sendJson(res, 400, { ok: false, error: 'nothing to say' });
          return;
        }
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 60_000);
          const upstream = await fetch(`${cfg.url.replace(/\/$/, '')}/say`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text, character: body.character ? String(body.character) : undefined, voice: body.voice }),
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (!upstream.ok) {
            const why = (await upstream.json().catch(() => ({ error: `speech door answered ${upstream.status}` }))) as { error?: string };
            sendJson(res, 502, { ok: false, error: why.error ?? `speech door answered ${upstream.status}` });
            return;
          }
          const wav = Buffer.from(await upstream.arrayBuffer());
          res.writeHead(200, {
            'content-type': 'audio/wav',
            'x-tts-provider': upstream.headers.get('x-tts-provider') ?? 'unknown',
            'x-tts-voice': upstream.headers.get('x-tts-voice') ?? '',
            'cache-control': 'no-store',
          });
          res.end(wav);
          return;
        } catch (error) {
          sendJson(res, 502, { ok: false, error: `no speech door reachable: ${(error as Error).message}` });
          return;
        }
      }

      if (p === '/api/monitor' && method === 'POST') {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        const title = String(body.title ?? '').trim();
        const text = String(body.text ?? '').trim();
        if (!title && !text) {
          sendJson(res, 400, { ok: false, error: 'a card needs a title or a text' });
          return;
        }
        const kind = (['question', 'output', 'goal', 'note', 'speaker'].includes(String(body.kind)) ? String(body.kind) : 'note') as MonitorCard['kind'];
        pushCard({
          kind,
          title,
          text,
          at: new Date().toISOString(),
          ...(body.character ? { character: String(body.character) } : {}),
          ...(body.audio ? { audio: String(body.audio) } : {}),
          ...(Array.isArray(body.options) ? { options: body.options.map(String) } : {}),
        });
        await publish();
        sendJson(res, 201, { ok: true, monitor: { card: monitorCard(), index: monitor.index, total: monitor.stack.length } });
        return;
      }

      if (p === '/api/monitor/back' && method === 'POST') {
        if (monitor.index > 0) monitor.index -= 1;
        saveMonitor();
        await publish();
        sendJson(res, 200, { ok: true, monitor: { card: monitorCard(), index: monitor.index, total: monitor.stack.length } });
        return;
      }

      // POST /api/note — another door telling the operator something. It becomes a turn, not a toast: a toast is
      // gone in four seconds and the whole point of the pane is that nothing is.
      if (p === '/api/note' && method === 'POST') {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        const from = String(body.from ?? 'a door').slice(0, 40);
        const subject = String(body.subject ?? '').trim();
        const text = String(body.text ?? '').trim();
        const severity = String(body.severity ?? 'note');
        if (!text && !subject) {
          sendJson(res, 400, { ok: false, error: 'a note needs text' });
          return;
        }
        const mark = severity === 'alert' ? 'ALERT ' : severity === 'warn' ? 'warn  ' : '';
        const line = [mark + from, subject, text].filter(Boolean).join(' · ');
        const turn = thread.append({ id: turnId('n'), at: new Date().toISOString(), role: 'note', text: line });
        sendJson(res, 201, { ok: true, turn });
        return;
      }

      if (p === '/api/say' && method === 'POST') {
        if (busy) {
          sendJson(res, 409, { ok: false, error: 'still answering the last one' });
          return;
        }
        let text = '';
        try {
          const body = JSON.parse((await readBody(req)) || '{}') as { text?: unknown };
          text = String(body.text ?? '').trim();
        } catch {
          sendJson(res, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        if (!text) {
          sendJson(res, 400, { ok: false, error: 'nothing to ask' });
          return;
        }

        const you = thread.append({ id: turnId('you'), at: new Date().toISOString(), role: 'you', text });
        pushCard({ kind: 'question', title: text.length > 180 ? text.slice(0, 177) + '…' : text, text: '', at: new Date().toISOString() });
        await publish();
        busy = true;
        try {
          const run = await ask({ ...options.agent, session: readSession() }, text, you.id);
          if (run.sessionId) writeSession(run.sessionId);
          const reply = thread.append({
            id: turnId('e'),
            at: new Date().toISOString(),
            role: run.ok ? 'echidna' : 'system',
            text: run.ok ? run.text : `could not answer: ${run.error ?? 'unknown'}\n\n${run.text}`.trim(),
            ms: run.ms,
            sessionId: run.sessionId,
            failed: !run.ok,
          });
          if (run.ok) {
            pushCard({ kind: 'output', title: 'Echidna', text: run.text.slice(0, 900), at: new Date().toISOString() });
          }
          await publish();
          sendJson(res, run.ok ? 200 : 502, { ok: run.ok, turns: [you, reply] });
        } finally {
          busy = false;
        }
        return;
      }

      if (p === '/api/clear' && method === 'POST') {
        thread.clear();
        sendJson(res, 200, { ok: true });
        return;
      }

      if (method === 'GET') {
        const rel = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
        let file = path.join(options.publicDir, rel);
        // '/billboard' is a page, not a missing file: try the .html twin before saying 404, so a URL people can type
        // is a URL that works.
        if (!fs.existsSync(file) && !path.extname(rel)) {
          const twin = `${file}.html`;
          if (fs.existsSync(twin) && fs.statSync(twin).isFile()) file = twin;
        }
        // never serve outside public/: a door that hands out ..\.. is not a door
        if (!file.startsWith(options.publicDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          sendJson(res, 404, { ok: false, error: 'no such file', path: p });
          return;
        }
        res.writeHead(200, {
          'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        });
        fs.createReadStream(file).pipe(res);
        return;
      }

      sendJson(res, 405, { ok: false, error: `${method} is not allowed on ${p}` });
    })().catch((error: Error) => {
      try {
        sendJson(res, 500, { ok: false, error: error.message });
      } catch {
        /* the socket is already gone */
      }
    });
  });
}

export type { Turn };
