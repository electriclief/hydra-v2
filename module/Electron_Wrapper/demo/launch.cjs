/**
 * launch.cjs — start the demo with an Electron binary, resolved in this order:
 *   1) ELECTRON_BIN environment variable (a path to electron / electron.exe)
 *   2) this module's own node_modules/electron      (npm i -D electron)
 *   3) a clear error telling you the two ways above.
 * Any extra args are forwarded to electron. Usage: npm run demo
 */
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

function resolveElectron() {
  const env = process.env.ELECTRON_BIN;
  if (env && fs.existsSync(env)) return env;
  try {
    const local = require('electron'); // resolves to the exe path once installed here
    if (typeof local === 'string' && fs.existsSync(local)) return local;
  } catch {
    /* not installed in this module — fall through */
  }
  return null;
}

const bin = resolveElectron();
if (!bin) {
  console.error(
    [
      'No Electron binary found for the demo.',
      'Either:   npm i -D electron        (installs it into this module), or',
      '         set ELECTRON_BIN to an electron executable, e.g.',
      '         ELECTRON_BIN="C:/path/to/electron.exe" npm run demo',
    ].join('\n'),
  );
  process.exit(1);
}

const main = path.join(__dirname, 'main.js');
const extra = process.argv.slice(2);
const child = spawn(bin, [main, ...extra], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
