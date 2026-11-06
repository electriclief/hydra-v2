/**
 * Join_module.js — THE ONE FILE LOADED by another code thread.
 *
 * The embed entry (folder dialect: ProcessWrapper -> ProcessWrapper_module.js, Join ->
 * Join_module.js). It re-exports the whole public surface and adds:
 *   - createModule(options)  pieces in the HOST thread, no port of its own
 *   - startModule(options)   this module's own little door (port 0 = OS-assigned)
 *
 * It is NOT `npm start` (public/js/main.js), which stands the module up as its own local
 * thread for a person. Different lives, one implementation — never a second copy.
 *
 * Run it directly for its own check:  node Join_module.js
 */
'use strict';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createShelf, Shelf } from './public/js/shelf.js';
import { startApi } from './public/js/apiServer.js';
import { createJoinClient, JoinClient } from './public/js/client.js';
import { createJoinMcpRegistry } from './public/js/mcpTools.js';
import { readDeclaration, readShelf, writeDeclaration, inferDeclaration } from './public/js/declaration.js';
import { resolve as resolveName, buildShelf, toEntry } from './public/js/resolver.js';
import { loadKinds, builtinKinds, normalizeKind, kindOf, writeKinds, KINDS_FILE } from './public/js/kinds.js';
import { createMemberStore, MemberStore, normalizeMember, memberToDeclaration } from './public/js/members.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * THE SURFACE. Options are the shelf root plus the two neighbour doors.
 * `shelfRoot` defaults to the shelf this module sits inside — module\Join -> module\.
 */
export function createModule(options = {}) {
  const shelfRoot = options.shelfRoot ?? path.resolve(HERE, '..');
  const shelf = createShelf({
    shelfRoot,
    pwUrl: options.pwUrl ?? 'http://127.0.0.1:8125',
    servicesUrl: options.servicesUrl ?? 'http://127.0.0.1:8128',
    probeTimeoutMs: options.probeTimeoutMs,
    dry: options.dry === true,
  });

  return {
    name: 'join',
    shelfRoot,
    shelf,
    declarations: () => shelf.declarations(),
    all: () => shelf.all(),
    resolve: (name) => shelf.resolveName(name),
    offered: () => shelf.offered(),
    probe: (port) => shelf.probe(port),
    /** The vocabulary (data) and the REGISTERED population — things joined at runtime. */
    kinds: shelf.kinds,
    members: shelf.members,
    /** The order things must come up in, from declared deps. */
    plan: () => shelf.plan(),
    mcpRegistry: createJoinMcpRegistry(shelf),
    describe: () => shelf.describe(),
  };
}

/** The module's own door. Returns the server AND the port it actually bound. */
export async function startModule(options = {}) {
  const mod = createModule(options);
  const started = await startApi({
    shelf: mod.shelf,
    port: options.port ?? 8131,
    host: options.host ?? '127.0.0.1',
    ...(options.token ? { token: options.token } : {}),
    publicRoot: path.join(HERE, 'public'),
  });
  return { ...mod, ...started };
}

export {
  Shelf, createShelf, startApi,
  JoinClient, createJoinClient,
  createJoinMcpRegistry,
  readDeclaration, readShelf, writeDeclaration, inferDeclaration,
  resolveName, buildShelf, toEntry,
  // the growing edge: kinds are data, and members are joined at runtime
  loadKinds, builtinKinds, normalizeKind, kindOf, writeKinds, KINDS_FILE,
  createMemberStore, MemberStore, normalizeMember, memberToDeclaration,
};

// --- the entry's own self-check: drive the REAL thing, set process.exitCode ---
if (process.argv[1] && process.argv[1].endsWith('Join_module.js')) {
  const mod = createModule();
  const checks = [
    ['createModule: it knows its own name', mod.name === 'join', mod.name],
    ['createModule: the shelf root is the module folder', /module$/i.test(mod.shelfRoot), mod.shelfRoot],
    ['createModule: it lists the shelf', Array.isArray(mod.declarations()), String(mod.declarations().length)],
    ['createModule: the mcp registry is six tools', mod.mcpRegistry.list().length === 6, String(mod.mcpRegistry.list().length)],
    ['createModule: it says what it is', mod.describe().includes('NAMES ONLY'), ''],
    ['startModule: a real door answers health', false, 'not started yet'],
  ];
  void (async () => {
    let ok = 0;
    let bad = 0;
    for (const [label, pass, extra] of checks.slice(0, 5)) {
      if (pass) { ok++; console.log(`pass ${label}`); }
      else { bad++; console.log(`FAIL ${label}  ${extra}`); }
    }
    // the last check is the only real one: a real door on an OS-assigned port
    const { server, port } = await startModule({ port: 0 });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      const body = await res.json();
      const pass = res.status === 200 && body.ok === true && body.module === 'join';
      if (pass) { ok++; console.log('pass startModule: health answers'); }
      else { bad++; console.log('FAIL startModule: health'); }
      // and the resolution reaches a real name
      const r = await fetch(`http://127.0.0.1:${port}/api/resolve/ProcessWrapper`);
      const rb = await r.json();
      const pass2 = rb.found === true && typeof rb.reason === 'string';
      if (pass2) { ok++; console.log(`pass startModule: resolves a real module (${rb.liveness})`); }
      else { bad++; console.log('FAIL startModule: resolve', JSON.stringify(rb).slice(0, 120)); }
      // and an absent name still carries its alternatives
      const a = await fetch(`http://127.0.0.1:${port}/api/resolve/DefinitelyNotHere`);
      const ab = await a.json();
      const pass3 = a.status === 404 && ab.found === false && Array.isArray(ab.alternatives) && ab.alternatives.length > 0;
      if (pass3) { ok++; console.log('pass startModule: a refusal carries what IS here'); }
      else { bad++; console.log('FAIL startModule: refusal shape', JSON.stringify(ab).slice(0, 120)); }
    } finally {
      server.close();
    }
    console.log(`[Join_module] ${ok} passed / ${bad} failed — ${bad === 0 ? 'GREEN' : 'RED'}`);
    process.exitCode = bad === 0 ? 0 : 1;
    setTimeout(() => process.exit(bad === 0 ? 0 : 1), 300).unref();
  })();
}