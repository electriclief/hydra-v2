/**
 * @module selftest
 * @description The gate: the label mapping, the three renderers, and the door driving REAL
 *              upstreams — a stub Services and a stub Scheduler on real ports — so hover's
 *              pages, the click's page, and the booking call are proved end to end.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchRows, lookFor } from './catalog.js';
import { renderAdvert, renderInputs, renderNotice } from './page.js';
import { startApiServer } from './apiServer.js';

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, extra = ''): void {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
  }
}

/** A Services door that answers like the real one, with one sound and one refused service. */
function stubServices(): Promise<{ url: string; stop(): Promise<void> }> {
  const definition = {
    name: 'llama-chat',
    task: 'text-generation',
    tasks: ['text-generation', 'image-text-to-text'],
    advert: { what: 'A whole conversation that lives on this machine.', karma: 5 },
    provider: { name: 'llama.cpp' },
    variables: {
      input: [
        { name: 'model', label: 'The brain', type: 'select', default: 'A.gguf', options: ['A.gguf', 'B.gguf'], help: 'on disk' },
        { name: 'note', label: 'Note', type: 'text', default: 'start the brain', full: true },
      ],
    },
    pages: { ad: '<div id="authored-ad">ADVERT BODY</div>', inputs: '<div id="authored-inputs">INPUTS BODY</div>' },
  };
  const server = http.createServer((req, res) => {
    const p = new URL(req.url ?? '/', 'http://x').pathname;
    const json = (body: unknown): void => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (p === '/api/services') return json({ ok: true, services: [
      { name: 'llama-chat', what: 'a brain', provider: 'llama.cpp', modes: ['gpu-full'], karma: 5, ok: true },
      { name: 'broken-one', what: 'a service file that does not parse', ok: false },
    ] });
    if (p === '/api/services/llama-chat') return json({ ok: true, service: definition });
    if (p === '/api/services/llama-chat/ad') return res.writeHead(200, { 'content-type': 'text/html' }).end(definition.pages.ad);
    if (p === '/api/services/llama-chat/inputs') return res.writeHead(200, { 'content-type': 'text/html' }).end(definition.pages.inputs);
    res.writeHead(404).end('no');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, stop: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

/** A Scheduler door that accepts a booking and hands back a queued job. */
function stubScheduler(): Promise<{ url: string; last: { body: Record<string, unknown> | null }; stop(): Promise<void> }> {
  const state: { last: { body: Record<string, unknown> | null } } = { last: { body: null } };
  const server = http.createServer((req, res) => {
    void (async () => {
      const p = new URL(req.url ?? '/', 'http://x').pathname;
      if (req.method === 'POST' && p === '/api/jobs') {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        state.last.body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, job: { id: 'j-0001', service: 'llama-chat', status: 'queued', inputs: state.last.body.inputs } }));
        return;
      }
      if (p === '/api/jobs/j-0001') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, job: { id: 'j-0001', status: 'done', result: { executed: false, note: 'dummy' } } }));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":{"message":"no"}}');
    })();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, last: state.last, stop: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

export async function runTests(): Promise<void> {
  // ── the label that appends to the name ──
  ok('text-generation reads LLM', lookFor('text-generation').label === 'LLM');
  ok('image-to-video reads Video', lookFor('image-to-video').label === 'Video');
  ok('text-to-image reads Image', lookFor('text-to-image').label === 'Image');
  ok('text-to-audio reads Music', lookFor('text-to-audio').label === 'Music');
  ok('an unknown task still says something', lookFor('quantum-folding').label === 'Folding', lookFor('quantum-folding').label);
  ok('no task at all still renders', lookFor('').label === 'Service');

  const services = await stubServices();
  const scheduler = await stubScheduler();
  const menu = await startApiServer({
    port: 0, host: '127.0.0.1', servicesUrl: services.url, schedulerUrl: scheduler.url, cacheMs: 0,
  });

  try {
    // ── the catalog read, as the page sees it ──
    const { rows, error } = await fetchRows({ servicesUrl: services.url });
    ok('the catalog is read', error === null && rows.length === 2, String(rows.length));
    const llama = rows.find((r) => r.name === 'llama-chat');
    ok('the task becomes a label', llama?.label === 'LLM' && llama?.emoji === '🦙', `${llama?.label}/${llama?.emoji}`);
    ok('the advertised sentence comes from the service file', llama?.what === 'A whole conversation that lives on this machine.');
    ok('the declared fields come through', llama?.fields.length === 2 && llama?.fields[0].type === 'select', String(llama?.fields.length));
    ok('a refused service is still a row, marked refused', rows.some((r) => r.name === 'broken-one' && r.ok === false));

    // ── the tree is a STATIC page: a page edit is a file edit ──
    const pagePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.html');
    const html = fs.readFileSync(pagePath, 'utf8');
    ok('the tree is a static file the door serves', html.includes('<!DOCTYPE html>') && html.includes("fetch('/api/menu')"), pagePath);
    ok('the arrow is its own control, and it opens the detail and the models',
      html.includes("disc.setAttribute('aria-expanded'") && html.includes('wrapEl.hidden = open'), 'arrow');

    // ── the model chooser: rows in the tree, specs and Launch beside it ──
    ok('every declared model is a clickable row under its service',
      html.includes("btn.className = 'mod'") && html.includes('openModel(service, m, btn)'), 'models');
    ok('a model row says whether the file is on disk',
      html.includes('paintChips') && html.includes("dot.textContent = '✓'"), 'chips');
    ok('opening the arrow checks the disk, so ticks appear without opening a model',
      html.includes('loadChips(service)') && html.includes("'/api/models/' + svc + '?verify=1'"), 'chips-on-open');
    ok('the page follows its own file — a page edit needs no restart',
      html.includes("'/api/page-version'") && html.includes('window.location.reload()'), 'self-reload');
    ok('the pane asks for the remembered sizes first, then the disk',
      html.includes("'/api/models/' + svc + '?verify=1'") && html.includes("fetch('/api/models/' + svc)"), 'remember');
    ok('Launch is one button; the queue only appears when the GPU is busy',
      html.includes("busy ? 'Queue it' : 'Launch'") && html.includes('one job per GPU'), 'launch');
    ok('a booked job is watched until it says done or failed',
      html.includes('watchJob(job.id, line)') && html.includes("job.status === 'done'"), 'watch');
    const typeBlock = html.slice(html.indexOf('.type {'), html.indexOf('}', html.indexOf('.type {')));
    ok('the type badge APPENDS to the name — no auto margin',
      html.includes('node-name') && !typeBlock.includes('margin-left'), typeBlock.replace(/\s+/g, ' ').slice(0, 70));
    ok('a click swaps the pane instead of leaving the page',
      html.includes('e.preventDefault()') && html.includes("show(service.name, 'inputs', row)"), 'click');
    ok('the pane is an iframe whose src changes', html.includes("pane.src = '/' + mode"), 'iframe');
    ok('the tree stays put; only the pane switches', html.includes('class="wrap"') && html.includes('<iframe id="pane"'), 'layout');
    ok('a modified click still opens the real page', html.includes('e.metaKey') && html.includes("link.href = '/inputs/'"), 'href');
    ok('the page says how to drive it', html.includes('↑ ↓') && html.includes('arrow') && html.includes('opens the models'));
    ok('nothing on the page hardcodes a service description', !html.includes('A whole conversation'));

    // ── the two pages the pane loads, framed ──
    const advert = renderAdvert(llama!, '<div id="authored-ad">ADVERT BODY</div>', { schedulerUrl: scheduler.url });
    ok("the advert keeps the maker's HTML", advert.includes('ADVERT BODY'));
    ok('and carries a way to the inputs', advert.includes('/inputs/llama-chat'));
    const embeddedAd = renderAdvert(llama!, '<div id="authored-ad">ADVERT BODY</div>', { schedulerUrl: scheduler.url }, true);
    ok('embedded, the advert drops its own bar — the pane owns the header',
      embeddedAd.includes('ADVERT BODY') && !embeddedAd.includes('← menu'), 'bar');

    const inputs = renderInputs(llama!, '<div id="authored-inputs">INPUTS BODY</div>', { schedulerUrl: scheduler.url });
    ok("the inputs page keeps the maker's HTML", inputs.includes('INPUTS BODY'));
    ok('and builds one control per declared field',
      inputs.includes('name="model"') && inputs.includes('<select') && inputs.includes('name="note"'));
    ok('the select keeps its declared options in order',
      inputs.indexOf('A.gguf') < inputs.indexOf('B.gguf'));
    ok('the form books through this door, not the Scheduler direct', inputs.includes("fetch('/api/run'"));
    ok('the page says the runner is a dummy', inputs.includes('the runner is a dummy'));

    const embeddedIn = renderInputs(llama!, '<div id="authored-inputs">INPUTS BODY</div>', { schedulerUrl: scheduler.url }, true);
    ok('embedded, the inputs page keeps the form but loses the bar',
      embeddedIn.includes('id="run-form"') && !embeddedIn.includes('← menu'), 'embed');

    const notice = renderNotice('no such thing', 'the catalog lists everything');
    ok('a dead end names the way back', notice.includes('the catalog lists everything') && notice.includes('← the menu'));

    // ── the door, over real HTTP ──
    const root = (await (await fetch(menu.url + '/')).text());
    ok('GET / answers the static tree page', root.includes('Local AI') && root.includes('id="tree"') && root.includes("fetch('/api/menu')"));

    const api = (await (await fetch(menu.url + '/api/menu')).json()) as { services: { name: string }[] };
    ok('GET /api/menu is the same read', api.services.length === 2);

    const health = (await (await fetch(menu.url + '/health')).json()) as {
      ok: boolean; module: string; services: number | null; refused: number | null; catalog: unknown;
    };
    ok('health answers instantly and counts what was read',
      health.ok === true && health.services === 1 && health.refused === 1, JSON.stringify(health));
    ok('health says the catalog was read rather than implying it is verified now',
      typeof health.catalog === 'object' && health.catalog !== null, String(health.catalog));

    const adPage = await fetch(menu.url + '/advert/llama-chat');
    ok('GET /advert/:name frames the maker\'s page', adPage.status === 200 && (await adPage.text()).includes('ADVERT BODY'));

    const inPage = await fetch(menu.url + '/inputs/llama-chat');
    ok('GET /inputs/:name builds the form', inPage.status === 200 && (await inPage.text()).includes('name="model"'));

    const inEmbed = await (await fetch(menu.url + '/inputs/llama-chat?embed=1')).text();
    ok('embed=1 gives the pane a form without a second bar',
      inEmbed.includes('id="run-form"') && !inEmbed.includes('← menu'), 'embed');

    const refused = await fetch(menu.url + '/advert/broken-one');
    ok('a refused service has no page, and says why', refused.status === 404 && (await refused.text()).includes('refused'));

    const unknown = await fetch(menu.url + '/inputs/not-a-service');
    ok('an unknown name is a 404 with the name in it', unknown.status === 404);

    // ── booking: the one call the form makes ──
    const booked = await fetch(menu.url + '/api/run', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ service: 'llama-chat', inputs: { model: 'B.gguf', note: 'from the gate' } }),
    });
    const bookedBody = (await booked.json()) as { ok: boolean; job: { id: string; status: string } };
    ok('POST /api/run books a job', booked.status === 201 && bookedBody.job.status === 'queued', String(booked.status));
    ok('the booking reached the Scheduler with its inputs intact',
      scheduler.last.body?.service === 'llama-chat'
      && (scheduler.last.body?.inputs as { model?: string })?.model === 'B.gguf',
      JSON.stringify(scheduler.last.body));

    const readBack = (await (await fetch(menu.url + '/api/jobs/j-0001')).json()) as { job: { status: string } };
    ok('the job can be read back through the menu', readBack.job.status === 'done');

    const noRoute = (await (await fetch(menu.url + '/api/nope')).json()) as { error: { message: string } };
    ok('a dead end names the real routes', noRoute.error.message.includes('/api/run'));

    // ── upstreams down are reported, not invented ──
    await scheduler.stop();
    const dead = await fetch(menu.url + '/api/run', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ service: 'llama-chat', inputs: {} }),
    });
    const deadBody = (await dead.json()) as { error: { code: string; message: string } };
    ok('a dead Scheduler is a 502 that says where it looked',
      dead.status === 502 && deadBody.error.message.includes('Scheduler'), `${dead.status}/${deadBody.error?.code}`);

    const noCatalog = await startApiServer({ port: 0, host: '127.0.0.1', servicesUrl: 'http://127.0.0.1:1', schedulerUrl: scheduler.url, cacheMs: 0 });
    const stillThere = await fetch(noCatalog.url + '/');
    ok('the tree page is served even when the catalog is dead', stillThere.status === 200 && (await stillThere.text()).includes('id="tree"'));
    const deadCat = (await (await fetch(noCatalog.url + '/api/menu')).json()) as { error: string | null; services: unknown[] };
    ok('the dead catalog is reported in the data the page reads',
      deadCat.services.length === 0 && String(deadCat.error).includes('127.0.0.1:1'), String(deadCat.error).slice(0, 70));
    await noCatalog.stop();
  } finally {
    await menu.stop();
    await services.stop();
    try { await scheduler.stop(); } catch { /* already stopped */ }
  }

  console.log(`Menu — the gate: ${pass} passed / ${fail} failed — ${fail ? 'RED' : 'GREEN'}`);
  if (fail) process.exitCode = 1;}

void runTests();
