// Print one back end declaration from a service file as JSON.
//
// Why this exists: the service file is CommonJS inside a package that declares "type": "module", so neither a plain
// require() nor import() reads it the way the Services door does (the door has its own loader). This shim loads it the
// same way CommonJS would - module/exports/require - so `set-brain` applies exactly what the catalog declares instead of
// a copy of it kept somewhere else.
//
//   node brain-decl.cjs <service-file> <backend-id>
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const file = path.resolve(process.argv[2] || '');
const id = process.argv[3] || '';

let decl = null;
try {
  const code = fs.readFileSync(file, 'utf8');
  const m = new Module(file, null);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(code, file);
  decl = m.exports;
} catch (e) {
  console.error('could not read ' + file + ': ' + e.message);
  process.exit(3);
}

const backends = (decl && decl.backends) || [];
const one = backends.find((b) => b.id === id);
if (!one) {
  console.error('no back end "' + id + '" in ' + file + ' (has: ' + backends.map((b) => b.id).join(', ') + ')');
  process.exit(2);
}
console.log(JSON.stringify(one));
