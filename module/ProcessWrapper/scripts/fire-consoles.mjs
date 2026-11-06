#!/usr/bin/env node
/**
 * bring the rest of the shelf up as consoles UNDER ProcessWrapper
 * (the proven fire-consoles shape - one event per door, nothing reaches around it)
 * usage: node fire-consoles.mjs <shelfRoot> <nodeExe>
 */
const root = process.argv[2] || 'C:/Users/Leafdriving/Desktop/Receive/hydraV2/module';
const node = process.argv[3] || process.execPath;
const PW = 'http://127.0.0.1:8125';

const doors = [
  ['Event_Handler',   'Event_Handler/public/js/main.js'],
  ['State',           'State/public/js/main.js'],
  ['ResourceManager', 'ResourceManager/public/js/main.js'],
  ['Basic_App',       'Basic_App/public/js/main.js'],
];

// Services already answers on :8128 on this box (pid 4944) - probe, do not double-start.
async function portUp(p) {
  try { const r = await fetch(`http://127.0.0.1:${p}/health`, { signal: AbortSignal.timeout(2500) }); return r.ok || r.status === 404; }
  catch { return false; }
}

for (const [name, rel] of doors) {
  const cwd = `${root}/${name}`;
  const payload = { name: `console-${name}`, command: `${node} public/js/main.js`, cwd };
  try {
    const res = await fetch(`${PW}/api/events/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'add Process Console Display', payload }),
    });
    console.log(`  fired ${name.padEnd(16)} -> ${res.status}`);
  } catch (e) {
    console.log(`  FAILED ${name}: ${e.message}`);
  }
  await new Promise(r => setTimeout(r, 2500));
}

console.log('  waiting for the doors...');
for (let i = 0; i < 20; i++) {
  await new Promise(r => setTimeout(r, 2000));
  const up = [];
  for (const p of [8125, 8126, 8127, 8128, 8129, 8130]) if (await portUp(p)) up.push(p);
  console.log(`   t+${(i + 1) * 2}s  up: ${up.join(' ') || '(none)'}`);
  if ([8125, 8126, 8127, 8128, 8129, 8130].every(p => up.includes(p))) { console.log('  ALL SIX UP'); break; }
}
