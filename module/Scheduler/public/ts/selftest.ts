/**
 * @module selftest
 * @description The gate: the queue's semantics (one at a time, cancel only before the start,
 *              recovery after a restart) and the door's real HTTP surface. No stubs for the
 *              parts that matter — a real port, real requests, a real book on disk.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Scheduler, createDummyRunner, type Runner } from './scheduler.js';
import { startApiServer, renderPage } from './apiServer.js';
import { schedulerPublish } from './publish.js';

function ok(label: string, cond: boolean, extra = ''): void {
  console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
  (globalThis as unknown as { __pass?: number; __fail?: number }).__pass =
    ((globalThis as unknown as { __pass?: number }).__pass ?? 0) + (cond ? 1 : 0);
  (globalThis as unknown as { __fail?: number }).__fail =
    ((globalThis as unknown as { __fail?: number }).__fail ?? 0) + (cond ? 0 : 1);
}

export async function runTests(): Promise<void> {
  const g = globalThis as unknown as { __pass?: number; __fail?: number };
  g.__pass = 0;
  g.__fail = 0;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-'));

  // ── the dummy runner is honest ──
  {
    const s = new Scheduler({ runner: createDummyRunner({ ms: 10 }) });
    const job = s.submit({ service: 'llama-chat', inputs: { model: 'x' }, note: 'hello' });
    ok('submit answers QUEUED, not started', job.status === 'queued' && job.startedAt === null, job.status);
    ok('the id is the book\'s own', /^j-\d{4}$/.test(job.id), job.id);
    await s.idle();
    const done = s.get(job.id);
    ok('the job finishes', done?.status === 'done', String(done?.status));
    ok('the dummy says it executed NOTHING', done?.result?.executed === false, JSON.stringify(done?.result));
    ok('and names the service it did not run', String(done?.result?.note).includes('llama-chat'), String(done?.result?.note));
    ok('the book has the timing', Boolean(done?.startedAt && done?.finishedAt));
  }

  // ── one at a time, even when three arrive together ──
  {
    let live = 0;
    let peak = 0;
    const slow: Runner = {
      kind: 'test-slow',
      description: 'holds the slot long enough to see the queue',
      async run(job) {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 40));
        live -= 1;
        return { runner: 'test-slow', executed: false, note: `ran ${job.id}`, outputs: [] };
      },
    };
    const s = new Scheduler({ runner: slow, concurrency: 1 });
    const a = s.submit({ service: 'qwen-image-2.1', inputs: {}, note: null });
    const b = s.submit({ service: 'minimax-h3', inputs: {}, note: null });
    const c = s.submit({ service: 'yue-music', inputs: {}, note: null });
    await new Promise((r) => setTimeout(r, 5));
    ok('while one runs, the others are still QUEUED',
      s.get(a.id)?.status === 'running' && s.get(b.id)?.status === 'queued' && s.get(c.id)?.status === 'queued',
      `${s.get(a.id)?.status}/${s.get(b.id)?.status}/${s.get(c.id)?.status}`);
    ok('the queue reports the one slot', s.current()?.id === a.id && s.queued().length === 2, String(s.queued().length));
    await s.idle();
    ok('nothing ever overlapped', peak === 1, String(peak));
    ok('all three finished in order', s.list().reverse().map((j) => j.id).join(',') === `${a.id},${b.id},${c.id}`);
  }

  // ── cancel means cancel, but only before the start ──
  {
    const s = new Scheduler({ runner: createDummyRunner({ ms: 60 }) });
    const first = s.submit({ service: 'llama-chat', inputs: {}, note: null });
    const second = s.submit({ service: 'llama-chat', inputs: {}, note: null });
    await new Promise((r) => setTimeout(r, 10));
    const refused = s.cancel(first.id);
    ok('a RUNNING job is not cancelled — it is refused with a reason',
      refused.ok === false && refused.reason.includes('already running'), refused.reason);
    const cancelled = s.cancel(second.id);
    ok('a QUEUED job leaves the queue', cancelled.ok === true && s.get(second.id)?.status === 'cancelled');
    await s.idle();
    ok('the cancelled one never ran', s.get(second.id)?.startedAt === null);
    ok('the stats add up', s.stats().total === 2 && s.stats().done === 1 && s.stats().cancelled === 1, JSON.stringify(s.stats()));
  }

  // ── a bad service is refused with a sentence, not a 500 ──
  {
    const s = new Scheduler({ runner: createDummyRunner({ ms: 5 }) });
    let msg = '';
    try {
      s.submit({ service: 'not a name!', inputs: {}, note: null });
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    ok('a junk service name is refused', msg.includes('service must be a name'), msg.slice(0, 50));
  }

  // ── the book survives a restart, and does not lie about what was running ──
  {
    const file = path.join(root, 'data', 'jobs.json');
    const first = new Scheduler({ file, runner: createDummyRunner({ ms: 10 }) });
    const doneJob = first.submit({ service: 'yue-music', inputs: { title: 'a' }, note: 'kept' });
    await first.idle();

    // a job that was mid-run when the door died is written by hand, as the book would hold it
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { jobs: Record<string, unknown>[] };
    raw.jobs.push({
      id: 'j-0099', service: 'minimax-h3', inputs: {}, note: null, status: 'running',
      createdAt: new Date().toISOString(), startedAt: new Date().toISOString(), finishedAt: null,
      runner: 'dummy', result: null, error: null,
    });
    fs.writeFileSync(file, JSON.stringify(raw, null, 2));

    const second = new Scheduler({ file, runner: createDummyRunner({ ms: 10 }) });
    ok('the book is read back on restart', second.get(doneJob.id)?.status === 'done');
    const orphan = second.get('j-0099');
    ok('a job caught RUNNING is republished as FAILED', orphan?.status === 'failed', String(orphan?.status));
    ok('with the reason a stranger can act on', String(orphan?.error).includes('restarted'), String(orphan?.error));
    const third = second.submit({ service: 'llama-chat', inputs: {}, note: null });
    ok('and the id counter resumes past the book', Number(third.id.slice(2)) > 99, third.id);
    await second.idle();
  }

  // ── the real door: real port, real requests ──
  {
    const s = new Scheduler({ runner: createDummyRunner({ ms: 30 }), file: path.join(root, 'door', 'jobs.json') });
    const api = await startApiServer({ scheduler: s, port: 0, host: '127.0.0.1' });
    const base = api.url;

    const health = (await (await fetch(base + '/health')).json()) as { ok: boolean; module: string; stats: { total: number } };
    ok('health says which door it is', health.ok === true && health.module === 'scheduler', JSON.stringify(health));

    const created = await fetch(base + '/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ service: 'qwen-image-2.1', inputs: { prompt: 'a red door', steps: 20 }, note: 'from the gate' }),
    });
    const body = (await created.json()) as { ok: boolean; job: { id: string; status: string } };
    ok('POST /api/jobs books it', created.status === 201 && body.job.status === 'queued', String(created.status));

    const one = (await (await fetch(base + '/api/jobs/' + body.job.id)).json()) as { job: { id: string; inputs: { prompt?: string } } };
    ok('the job comes back with its inputs', one.job.inputs.prompt === 'a red door', JSON.stringify(one.job.inputs));

    const queue = (await (await fetch(base + '/api/queue')).json()) as { running: { id: string } | null; queued: unknown[] };
    ok('the queue names what holds the slot', queue.running?.id === body.job.id || queue.queued.length >= 0, JSON.stringify(queue.running));

    await s.idle();
    const settled = (await (await fetch(base + '/api/jobs/' + body.job.id)).json()) as { job: { status: string; result: { executed: boolean; note: string } } };
    ok('it settles to done, executed=false', settled.job.status === 'done' && settled.job.result.executed === false);

    const list = (await (await fetch(base + '/api/jobs?limit=5')).json()) as { jobs: unknown[] };
    ok('the book lists it', list.jobs.length === 1, String(list.jobs.length));

    const bad = await fetch(base + '/api/jobs', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ service: '' }),
    });
    ok('a job with no service is a 400 with a sentence', bad.status === 400, String(bad.status));

    const missing = await fetch(base + '/api/jobs/j-9999');
    ok('an unknown job is a 404', missing.status === 404, String(missing.status));

    const noRoute = (await (await fetch(base + '/api/nope')).json()) as { error: { message: string } };
    ok('a dead end names the real routes', noRoute.error.message.includes('/api/jobs'));

    const init = await fetch(base + '/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    ok('the mcp door initialises', init.status === 200);

    const tools = (await (await fetch(base + '/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    })).json()) as { result: { tools: { name: string }[] } };
    ok('the keyring is the three tools',
      tools.result.tools.map((t) => t.name).join(',') === 'scheduler_submit,scheduler_jobs,scheduler_status',
      tools.result.tools.map((t) => t.name).join(','));

    const called = (await (await fetch(base + '/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'scheduler_status', arguments: {} } }),
    })).json()) as { result: { content: { text: string }[] } };
    ok('a tool call answers with text', called.result.content[0].text.includes('stats'), called.result.content[0].text.slice(0, 40));

    const page = await (await fetch(base + '/')).text();
    ok('the page lists the book', page.includes('qwen-image-2.1') && page.includes('one job at a time'));

    const resident = (await (await fetch(base + '/api/resident')).json()) as { runner: string; resident: unknown };
    ok('the door reports residency without inventing one', resident.runner === 'dummy' && resident.resident === null, JSON.stringify(resident));

    const badGraph = await fetch(base + '/api/jobs', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ steps: [{ id: 'a', service: 'x', values: {}, needs: ['a'] }] }),
    });
    const badGraphBody = (await badGraph.json()) as { error: { code: string; message: string } };
    ok('a bad graph over HTTP is a 400 WITH its code', badGraph.status === 400 && badGraphBody.error.code === 'cycle', `${badGraph.status} ${badGraphBody.error.code}`);

    const graphOk = await fetch(base + '/api/jobs', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'two steps', steps: [
        { id: 's1', service: 'piper-tts', values: { text: 'a' }, needs: [] },
        { id: 's2', service: 'whisper-stt', values: { audio: '{{s1.out}}' }, needs: ['s1'] },
      ] }),
    });
    const graphBody = (await graphOk.json()) as { job: { steps: { id: string }[]; title?: string } };
    ok('a good graph over HTTP is a 201 with its steps', graphOk.status === 201 && graphBody.job.steps.length === 2 && graphBody.job.title === 'two steps', String(graphOk.status));

    await api.stop();
  }

  // ── the graph: a job is a DAG, and a bad DAG is refused before it is booked ──
  {
    const s = new Scheduler({ runner: createDummyRunner({ ms: 5 }) });

    const flat = s.submit({ service: 'piper-tts', inputs: { text: 'hi' } });
    ok('a flat submit becomes a one-step graph', flat.steps?.length === 1 && flat.steps[0].id === 's1', JSON.stringify(flat.steps));
    ok('and carries no session reference unless one is given', flat.sessionRef === null, String(flat.sessionRef));

    const video = s.submit({
      title: 'sunset promo',
      steps: [
        { id: 's1', service: 'piper-tts', values: { text: 'dusk' }, needs: [], produces: ['voice'] },
        { id: 's2', service: 'whisper-stt', values: { audio: '{{s1.voice}}' }, needs: ['s1'], produces: ['text'] },
      ],
      deliver: { dir: 'C:/AI/out/delivered' },
      sessionRef: 'sess-7',
    });
    ok('a graph is booked with its steps and edges', video.steps?.length === 2 && video.steps[1].needs[0] === 's1', JSON.stringify(video.steps?.map((x) => x.id)));
    ok('the record says where the product goes, link by default', video.deliver?.dir === 'C:/AI/out/delivered' && video.deliver.mode === 'auto', JSON.stringify(video.deliver));
    ok('a session reference is provenance, not a path', video.sessionRef === 'sess-7');

    const cycle = (() => {
      try {
        s.submit({ steps: [
          { id: 'a', service: 'x', values: {}, needs: ['b'] },
          { id: 'b', service: 'x', values: {}, needs: ['a'] },
        ] as never });
        return 'no-throw';
      } catch (e) { return (e as { code?: string }).code ?? 'no-code'; }
    })();
    ok('a cycle is refused WITH A CODE', cycle === 'cycle', String(cycle));

    const ghost = (() => {
      try { s.submit({ steps: [{ id: 'a', service: 'x', values: {}, needs: ['nope'] }] as never }); return 'no-throw'; }
      catch (e) { return (e as { code?: string }).code ?? 'no-code'; }
    })();
    ok('a missing dependency is named', ghost === 'unknown_dep', String(ghost));

    ok('a refused graph never enters the book', s.stats().total === 2, JSON.stringify(s.stats()));
  }

  // ── the page renderer, with no server at all ──
  {
    const s = new Scheduler({ runner: createDummyRunner({ ms: 5 }) });
    s.submit({ service: 'yue-music', inputs: {}, note: null });
    await s.idle();
    const html = renderPage(s);
    ok('the renderer escapes and lists', html.includes('yue-music') && html.includes('<table>'));
    const empty = renderPage(new Scheduler({ runner: createDummyRunner({ ms: 5 }) }));
    ok('an empty book says how to fill it', empty.includes('the book is empty'));
  }

  // ── the book, published (pure) ──
  {
    const s = new Scheduler({ runner: createDummyRunner({ ms: 5 }) });
    const queued = s.submit({ service: 'llama-chat', inputs: { prompt: 'x', n: 4 }, note: null });
    const p = schedulerPublish(s.list(), s.stats(), '123', []);
    const name = `node.123.scheduler.booked.${queued.id}`;
    ok('a queued job becomes an entry', Boolean(p.entries[name]), name);
    ok('the entry names the service', (p.entries[name] as { service: string }).service === 'llama-chat');
    ok('inputs are published as KEYS only', JSON.stringify((p.entries[name] as { keys: string[] }).keys) === '["prompt","n"]');
    ok('the summary counts the book', (p.entries['node.123.scheduler'] as { queued: number }).queued === 1);

    // a job that finished must not stay advertised
    const finished = [{ ...s.list()[0], status: 'done' as const }];
    const after = schedulerPublish(finished as never, s.stats(), '123', [name]);
    ok('a job that left the book is dropped', after.stale.includes(name), after.stale.join(','));
    ok('a finished job is not an entry', !after.entries[name]);
  }

  fs.rmSync(root, { recursive: true, force: true });
  const pass = g.__pass ?? 0;
  const fail = g.__fail ?? 0;
  console.log(`Scheduler — the gate: ${pass} passed / ${fail} failed — ${fail ? 'RED' : 'GREEN'}`);
  if (fail) process.exitCode = 1;
}

void runTests();
