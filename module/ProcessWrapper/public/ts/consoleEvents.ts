/**
 * @module consoleEvents
 * @description The console palette: three registered events — "add Process Console Display",
 *              "kill Process Console Display" and "note System Drain" — hosted on an
 *              Event_Handler instance
 *              embedded IN THIS THREAD (the wrapper's own). A trigger anywhere (the
 *              window's footer form, the API, a command-line arg, a script, a curl…)
 *              just fills the fields and fires the event; the add door launches the
 *              process through the wrapper, the kill door ends it. One door, many hands.
 * @intent Operator concept (2026-09-25): ProcessWrapper is launched once — everything
 *         else arrives as events. No pre-decisions: whatever the registration supplies
 *         (name · provider wiring · cwd · args · env · shell) lands in the launch; only
 *         what is missing falls back to the lean defaults below. Extras are kept visible
 *         in the outcome event — never dropped.
 */

import path from 'node:path';
import type { ProcessWrapperService } from './processWrapper.js';

// --- Interface Definitions ---

/** The fields the add event understands; extras ride along, visible, never dropped. */
export interface ConsoleAddPayload {
  name?: string;
  /** The wiring to connect (the Service Provider block); `launch` is the command. */
  provider?: {
    name?: string;
    launch?: string;
    repo?: string;
    probe?: string;
    update?: string;
    [key: string]: unknown;
  };
  /** A direct command — wins over provider.launch when both are present. */
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  shell?: boolean;
  /** Pass through to the launch — a display meant to be SEEN sets this false. */
  hideWindow?: boolean;
  [key: string]: unknown;
}

/** The fields the kill event understands. */
export interface ConsoleKillPayload {
  id?: string;
  name?: string;
  /** Skip the graceful ask (default: ask first, escalate to force only if needed). */
  force?: boolean;
  graceMs?: number;
  [key: string]: unknown;
}

export interface ConsoleEventsOptions {
  wrapper: ProcessWrapperService;
  /** Where the rolling event log lands (default: <cwd>/data/console-events.log). */
  logPath?: string;
  /** cwd used when a registration supplies none (default: <cwd>). */
  defaultCwd?: string;
}

/** One palette entry, as served. */
export interface ConsoleEventInfo {
  name: string;
  description: string;
  fields: string[];
}

/** The palette's public face. */
export interface ConsoleEvents {
  module: string;
  logPath: string;
  /** The two events, described — what this wrapper can be asked. */
  list(): ConsoleEventInfo[];
  /** Fire the thing. Fire-and-forget: the receipt answers now, the outcome lands as its own event. */
  trigger(name: string, payload?: Record<string, unknown>, source?: string): {
    ok: boolean;
    name?: string;
    source?: string;
    at?: string;
    code?: string;
  };
  /** The rolling log (newest last), capped. */
  log(limit?: number): { matched: number; lines: unknown[] };
  /** The embedded handler, as built (tests and advanced callers). */
  handler: {
    register(name: string, fn: (payload: any, ctx: any) => any, options?: any): any;
    trigger(name: string, payload?: any, options?: any): any;
    read(query?: any): any;
    close(): void;
  };
  close(): void;
}

// --- Function Definitions ---

/**
 * Build the palette for one wrapper, in this thread. The Event_Handler itself is loaded
 * from the sibling module's embed entry (module/Event_Handler/Event_Handler_module.js) —
 * the implementation lives there; this file only holds the two registrations.
 */
export async function createConsoleEvents(options: ConsoleEventsOptions): Promise<ConsoleEvents> {
  const wrapper = options.wrapper;
  const defaultCwd = options.defaultCwd ?? process.cwd();
  const logPath = options.logPath ?? path.join(process.cwd(), 'data', 'console-events.log');

  // The sibling module's one entry file — the event machinery rides in THIS thread.
  const ehUrl = new URL('../../../Event_Handler/Event_Handler_module.js', import.meta.url);
  const eh = (await import(ehUrl.href)) as {
    createModule: (o: { logPath: string }) => { handler: ConsoleEvents['handler'] };
  };
  const handler = eh.createModule({ logPath }).handler;

  let added = 0;

  /** Find the console a kill is aimed at: by id first, then live name. */
  const findTarget = (payload: ConsoleKillPayload) => {
    const all = wrapper.list();
    if (payload.id) return all.find((p) => p.id === payload.id) ?? null;
    if (payload.name) {
      return (
        all.find((p) => p.name === payload.name && (p as { tag?: string | null }).tag === 'console') ??
        all.find((p) => p.name === payload.name) ??
        null
      );
    }
    return null;
  };

  const isLive = (id: string): boolean => {
    const rec = wrapper.get(id);
    return Boolean(rec && (rec.life === 'running' || rec.life === 'starting'));
  };

  // --- the add door -------------------------------------------------------------
  handler.register(
    'add Process Console Display',
    async (payload: ConsoleAddPayload = {}) => {
      const supplied = { ...payload };
      const provider = payload.provider && typeof payload.provider === 'object' ? payload.provider : null;
      const command = String(payload.command ?? provider?.launch ?? '').trim();
      if (!command) {
        return { ok: false, error: 'no wiring: supply provider.launch (the Service Provider block) or command', supplied };
      }
      let name = String(payload.name ?? '').trim();
      if (!name) {
        added += 1;
        name = `console-${added}`;
      }
      const rec = await wrapper.launch({
        name,
        command,
        args: Array.isArray(payload.args) ? payload.args.map(String) : undefined,
        cwd: payload.cwd ? String(payload.cwd) : defaultCwd,
        env: payload.env && typeof payload.env === 'object' ? payload.env : undefined,
        shell: payload.shell === true,
        // a GUI app that must be SEEN asks for it — Electron's console IS the app
        hideWindow: payload.hideWindow === false ? false : true,
        tag: 'console',
      });
      return { ok: true, id: rec.id, name: rec.name, life: rec.life, streamFile: rec.streamFile, supplied };
    },
    { description: 'Add a console display: name + the provider wiring (provider.launch is the command) — the wrapper launches it and the display appears' },
  );

  // --- the kill door ------------------------------------------------------------
  handler.register(
    'kill Process Console Display',
    async (payload: ConsoleKillPayload = {}) => {
      const rec = findTarget(payload);
      if (!rec) return { ok: false, error: 'no console matches that id or name', supplied: { ...payload } };
      let kill = await wrapper.kill(rec.id, {
        force: payload.force === true,
        graceMs: typeof payload.graceMs === 'number' ? payload.graceMs : undefined,
      });
      // The graceful ask first; the same door escalates only when it did not land.
      if (payload.force !== true && isLive(rec.id)) {
        kill = await wrapper.kill(rec.id, {
          force: true,
          graceMs: typeof payload.graceMs === 'number' ? payload.graceMs : undefined,
        });
      }
      const after = wrapper.get(rec.id);
      return { ok: true, id: rec.id, name: rec.name, life: after?.life ?? rec.life, kill };
    },
    { description: 'Kill a console by id or name: graceful ask first, escalation to force only if it did not land (force:true skips the ask)' },
  );

  // --- the drain note -------------------------------------------------------------
  handler.register(
    'note System Drain',
    async (payload: Record<string, unknown> = {}) => ({ ok: true, noted: { ...payload } }),
    { description: 'A drain was noticed on this machine: the watch fires it by itself; any hand may fire one. The event log keeps the receipt.' },
  );

  const list = (): ConsoleEventInfo[] => [
    {
      name: 'add Process Console Display',
      description: 'Add a console display: the wrapper launches the command and its display appears in the window.',
      fields: ['name', 'provider.launch (or command)', 'args', 'cwd', 'env', 'shell'],
    },
    {
      name: 'kill Process Console Display',
      description: 'End a console: graceful ask first, escalation to force only if it did not land.',
      fields: ['id | name', 'force', 'graceMs'],
    },
    {
      name: 'note System Drain',
      description: 'A drain was noticed on this machine (fired by the system watch; any hand may fire one) — the event log keeps the receipt.',
      fields: ['name', 'pid', 'cpuPeak', 'diskPeakMBs', 'samples', 'unexpected'],
    },
  ];

  const trigger = (name: string, payload: Record<string, unknown> = {}, source = 'api') =>
    handler.trigger(String(name), payload, { source }) as ReturnType<ConsoleEvents['trigger']>;

  const log = (limit = 50) => handler.read({ limit }) as { matched: number; lines: unknown[] };

  return {
    module: 'consoleEvents',
    logPath,
    list,
    trigger,
    log,
    handler,
    close: () => handler.close(),
  };
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const { createWrapper } = await import('./processWrapper.js');
  const { createStreamHub } = await import('./streamHub.js');
  const { startApiServer } = await import('./apiServer.js');

  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };
  const waitFor = async (cond: () => boolean, ms = 8000): Promise<boolean> => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (cond()) return true;
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    return cond();
  };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-console-'));
  const wrapper = createWrapper({ streamDir: path.join(dir, 'streams'), graceMs: 400 });
  const palette = await createConsoleEvents({
    wrapper,
    logPath: path.join(dir, 'console-events.log'),
    defaultCwd: dir,
  });
  const hub = createStreamHub(wrapper);
  const api = await startApiServer({
    wrapper,
    hub,
    port: 0,
    registryFile: path.join(dir, 'data.yaml'),
    palette,
  });
  const base = api.url;
  const outcomeLines = () =>
    palette.log(500).lines as Array<{ name?: string; of?: string; result?: any }>;
  const latestOutcome = (ofName: string) => outcomeLines().filter((l) => l.name === `${ofName}.result`).pop();

  try {
  // 1. the palette itself
  const paletteList = palette.list();
  ok('the palette lists the three doors', paletteList.length === 3 && paletteList[0].name === 'add Process Console Display' && paletteList[1].name === 'kill Process Console Display' && paletteList[2].name === 'note System Drain', JSON.stringify(paletteList.map((p) => p.name)));

  // 2. the add door — a real launch through the wiring
  const fired = palette.trigger('add Process Console Display', {
    name: 't-one',
    provider: { name: 'node', launch: process.execPath },
    args: ['-e', "console.log('console-ok')"],
  });
  ok('the add answers fire-and-forget', fired.ok === true && fired.name === 'add Process Console Display', JSON.stringify(fired));
  ok('the launch happens', await waitFor(() => wrapper.list().some((p) => p.name === 't-one')));
  const one = wrapper.list().find((p) => p.name === 't-one')!;
  ok('it carries the supplied name + the console tag', one.name === 't-one' && (one as { tag?: string | null }).tag === 'console', JSON.stringify({ name: one.name, tag: (one as { tag?: string | null }).tag }));
  await wrapper.awaitExit(one.id, 15000);
  const text = await (await fetch(`${base}/api/processes/${one.id}/output`)).text();
  ok('its console text streams like any process', text.includes('console-ok'), text.slice(0, 120));
  ok('the outcome lands as its own event', await waitFor(() => Boolean(latestOutcome('add Process Console Display'))));
  const out1 = latestOutcome('add Process Console Display');
  ok('the outcome carries the record + the supplied fields', out1?.result?.ok === true && out1?.result?.name === 't-one' && out1?.result?.supplied?.provider?.name === 'node', JSON.stringify(out1?.result)?.slice(0, 200));

  // 3. the lean defaults: nothing supplied but the wiring
  palette.trigger('add Process Console Display', { provider: { launch: process.execPath }, args: ['-e', '1'] });
  ok('the lean defaults stand in: name console-1', await waitFor(() => wrapper.list().some((p) => p.name === 'console-1')));
  const leanOne = wrapper.list().find((p) => p.name === 'console-1');
  ok(
    'the defaulted cwd is the lean default',
    Boolean(leanOne) && String(leanOne?.cwd).replace(/\\/g, '/') === dir.replace(/\\/g, '/'),
    leanOne ? String(leanOne.cwd) : 'no console-1 found',
  );

  // 4. a registration with no wiring is refused — visibly, in the outcome
  palette.trigger('add Process Console Display', { name: 'empty-one' });
  ok(
    'no wiring → the outcome says so (never dropped)',
    await waitFor(() => outcomeLines().some((l) => l.name === 'add Process Console Display.result' && l.result?.ok === false && String(l.result?.error).includes('no wiring'))),
  );

  // 5. the same doors walk the API face
  const pal = (await (await fetch(`${base}/api/events`)).json()) as { palette: unknown[] };
  ok('GET /api/events serves the palette', Array.isArray(pal.palette) && pal.palette.length === 3);
  const wireFired = await fetch(`${base}/api/events/trigger`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'add Process Console Display',
      payload: { name: 't-wire', provider: { launch: process.execPath }, args: ['-e', '2'] },
    }),
  });
  ok('the door takes a trigger (202, fire-and-forget)', wireFired.status === 202, String(wireFired.status));
  ok('the trigger really launched over the wire', await waitFor(() => wrapper.list().some((p) => p.name === 't-wire')));
  const logRes = (await (await fetch(`${base}/api/events/log?limit=5`)).json()) as { log: { matched: number } };
  ok('GET /api/events/log serves the rolling record', typeof logRes.log?.matched === 'number' && logRes.log.matched > 0, JSON.stringify(logRes).slice(0, 120));

  // 6. the kill door — graceful ask, escalation only if needed
  palette.trigger('add Process Console Display', {
    name: 't-sleep',
    command: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 60000)'],
  });
  await waitFor(() => wrapper.list().some((p) => p.name === 't-sleep'));
  const sleepy = wrapper.list().find((p) => p.name === 't-sleep')!;
  ok('the sleepy console is live', sleepy.life === 'running' || sleepy.life === 'starting', String(sleepy.life));
  palette.trigger('kill Process Console Display', { name: 't-sleep' });
  ok(
    'the kill event ends it',
    await waitFor(() => {
      const rec = wrapper.get(sleepy.id);
      return Boolean(rec && rec.life !== 'running' && rec.life !== 'starting');
    }, 15000),
  );
  const killed = wrapper.get(sleepy.id)!;
  ok('it ended as killed (through the door)', killed.life === 'killed', String(killed.life));

  // 7. an unknown event refuses with a code (the palette is the machine's menu)
  const unknown = palette.trigger('nope', {});
  ok('an unknown event refuses with a code', unknown.ok === false && unknown.code === 'no_such_event', JSON.stringify(unknown));

  // 7b. the drain note door: fire-and-forget; the receipt lands as its own outcome
  const noted = palette.trigger('note System Drain', { name: 'chrome', cpuPeak: 30, samples: 2 }, 'test');
  ok('the drain note answers fire-and-forget', noted.ok === true && noted.name === 'note System Drain', JSON.stringify(noted));
  ok('the drain note lands in the record', await waitFor(() => outcomeLines().some((l) => l.name === 'note System Drain.result' && l.result?.ok === true)));

  // 8. extras are kept visible — never dropped
  palette.trigger('add Process Console Display', {
    name: 't-extra',
    provider: { launch: process.execPath },
    args: ['-e', '3'],
    favouriteColour: 'green',
  });
  ok(
    'un-understood extras ride in the outcome',
    await waitFor(() => outcomeLines().some((l) => l.name === 'add Process Console Display.result' && l.result?.supplied?.favouriteColour === 'green')),
  );

  } catch (err) {
    ok('the suite ran without a crash', false, (err as Error).message);
  } finally {
    await api.stop();
    await wrapper.shutdown(true);
    palette.close();
  }

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[consoleEvents] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}
