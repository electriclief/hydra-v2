// Standalone proof for the two new modules. No door, no Echidna, no network — node:fs only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateGraph, topoOrder, readySteps, resolveValues, fromLegacyJob } from '../public/js/graph.js';
import { deliver, verify, removeDelivered } from '../public/js/deliver.js';

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

// ---------- graph ----------
console.log('graph:');
const video = [
  { id: 's1', service: 'qwen-image-2.1', node: '123', values: { prompt: 'jetty' }, needs: [], produces: ['image'] },
  { id: 's2', service: 'piper-tts', node: '127', values: { text: 'dusk' }, needs: [], produces: ['voice'] },
  { id: 's3', service: 'yue-music', node: '123', values: { prompt: 'strings' }, needs: [], produces: ['music'] },
  { id: 's4', service: 'sd-cpp-wan21', node: '134', needs: ['s1', 's2', 's3'],
    values: { image: '{{s1.image}}', audio: '{{s2.voice}}', music: '{{s3.music}}' } },
];
const good = validateGraph(video);
ok('the video DAG validates', good.ok, JSON.stringify(good.errors));
ok('topo puts s4 last', topoOrder(video).order.at(-1) === 's4', topoOrder(video).order.join(','));
ok('three steps are ready first', readySteps(video, new Set()).length === 3);

const cyc = validateGraph([
  { id: 'a', service: 'x', values: {}, needs: ['b'] },
  { id: 'b', service: 'y', values: {}, needs: ['a'] },
]);
ok('a cycle is refused by code', !cyc.ok && cyc.errors.some((e) => e.code === 'cycle'), JSON.stringify(cyc.errors));
ok('the cycle names its refs', cyc.errors.find((e) => e.code === 'cycle').refs.length === 2);

const unk = validateGraph([{ id: 'a', service: 'x', values: {}, needs: ['ghost'] }]);
ok('an unknown dep is refused', !unk.ok && unk.errors[0].code === 'unknown_dep', JSON.stringify(unk.errors));

const dup = validateGraph([
  { id: 'a', service: 'x', values: {}, needs: [] },
  { id: 'a', service: 'y', values: {}, needs: [] },
]);
ok('a duplicate id is refused', !dup.ok && dup.errors.some((e) => e.code === 'duplicate_step'));

const self = validateGraph([{ id: 'a', service: 'x', values: {}, needs: ['a'] }]);
ok('a self-edge is refused', !self.ok && self.errors.some((e) => e.code === 'cycle'));

ok('an empty job is refused', validateGraph([]).errors[0].code === 'empty_graph');

const res = resolveValues({ image: '{{s1.image}}', mix: ['{{s2.voice}}', 'plain'] }, { s1: { image: 'C:/d/s1.png' }, s2: { voice: 'C:/d/v.wav' } });
ok('tokens resolve to real paths', res.values.image === 'C:/d/s1.png' && res.values.mix[0] === 'C:/d/v.wav' && res.unresolved.length === 0);

const miss = resolveValues({ image: '{{s9.image}}' }, {});
ok('a missing artifact is reported, not invented', miss.unresolved.length === 1 && miss.values.image === '{{s9.image}}');

const legacy = fromLegacyJob({ id: 'j-0001', service: 'piper-tts', inputs: { text: 'hi' } });
ok('an old flat job becomes a one-step DAG', legacy.length === 1 && legacy[0].service === 'piper-tts' && validateGraph(legacy).ok);

// ---------- deliver ----------
console.log('deliver:');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hydra-deliver-'));
const session = path.join(tmp, 'data', 'jobs', 'j-0007');
fs.mkdirSync(session, { recursive: true });
fs.writeFileSync(path.join(session, 'narration.wav'), 'audio-bytes-here');
fs.mkdirSync(path.join(session, 'frames'), { recursive: true });
fs.writeFileSync(path.join(session, 'frames', '001.png'), 'png');
const results = path.join(tmp, 'results', 'sunset');

const dDir = deliver(path.join(session, 'frames'), results, 'link');
console.log(`  dir  -> ${dDir.mode}: ${dDir.note}`);
ok('a directory is attached as a junction, not copied', dDir.mode === 'junction');
ok('the junction verifies', verify(dDir).ok, verify(dDir).detail);
ok('the frames are visible through it', fs.existsSync(path.join(dDir.dest, '001.png')));

const dFile = deliver(path.join(session, 'narration.wav'), results, 'link');
console.log(`  file -> ${dFile.mode}: ${dFile.note}`);
ok('a same-volume file becomes a hard link', dFile.mode === 'hardlink');
ok('the hard link verifies as one inode', verify(dFile).ok, verify(dFile).detail);
ok('the hard link really shares the bytes', fs.statSync(dFile.dest).nlink === 2);

const dCopy = deliver(path.join(session, 'narration.wav'), path.join(tmp, 'copies'), 'copy');
console.log(`  copy -> ${dCopy.mode}: ${dCopy.note}`);
ok('copy mode copies', dCopy.mode === 'copy' && fs.statSync(dCopy.dest).nlink === 1);

const overwrite = (() => { try { deliver(path.join(session, 'narration.wav'), results, 'link'); return 'no-throw'; } catch { return 'refused'; } })();
ok('it refuses to overwrite an existing name', overwrite === 'refused');

const rm = removeDelivered(dDir.dest);
console.log(`  remove -> ${rm.how}`);
ok('removing the delivery does NOT eat the session data', fs.existsSync(path.join(session, 'frames', '001.png')) && rm.removed);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
