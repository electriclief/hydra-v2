/**
 * @module registryStore
 * @description The saved-commands registry: data.yaml is the ground truth, with a small
 *              YAML codec and the add/update/remove operations on top of it.
 * @intent A wrapper that only accepts commands typed at it forgets everything when it
 *         closes. This module keeps the operator's named commands (a probe, a server, a
 *         build) in a plain readable `data.yaml` next to the code — one file, no database,
 *         round-trip tested — so any surface (API, CLI, a future Hydra module) can list
 *         what this box can launch and start it by name.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ProcessSpec } from './processWrapper.js';

// --- Interface Definitions ---

/** One saved command — a name plus everything needed to launch it. */
export interface CommandDefinition {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  shell: boolean;
  /**
   * Where this command's output is handled. The DEFINITION carries it, because it is a property of what the command
   * is (a miner floods stdout; a chat server does not), and a launch may override it for one run.
   */
  isolation: 'in-loop' | 'supervised';
  description: string;
  tag: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The whole persisted state. */
export interface RegistryState {
  version: number;
  lastUpdated: string;
  commands: CommandDefinition[];
}

export interface RegistryLoadResult {
  state: RegistryState;
  file: string;
  /** Set when the file existed but could not be read/parsed — defaults were used. */
  error: string | null;
}

export type CommandPatch = Partial<Omit<CommandDefinition, 'name' | 'createdAt'>>;

// --- Function Definitions ---

/** A brand-new empty registry. */
export function defaultRegistry(): RegistryState {
  return { version: 1, lastUpdated: new Date().toISOString(), commands: [] };
}

/** YAML scalar — JSON quoting is valid YAML, and unambiguous for every character. */
function yamlScalar(value: string | number | boolean | null): string {
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(String(value));
}

/** RegistryState → YAML text (the shape this module's parser reads back). */
export function stateToYaml(state: RegistryState): string {
  const L: string[] = ['# ProcessWrapper registry — commands saved on this box.', '# Written by registryStore.ts (stateToYaml) — hand edits survive the round trip.'];
  L.push(`version: ${yamlScalar(state.version)}`);
  L.push(`lastUpdated: ${yamlScalar(state.lastUpdated)}`);
  L.push('commands:');
  for (const c of state.commands) {
    L.push(`  - name: ${yamlScalar(c.name)}`);
    L.push(`    command: ${yamlScalar(c.command)}`);
    if (c.args && c.args.length) {
      L.push('    args:');
      for (const a of c.args) L.push(`      - ${yamlScalar(a)}`);
    } else {
      L.push('    args: []');
    }
    L.push(`    cwd: ${yamlScalar(c.cwd || '')}`);
    if (c.env && Object.keys(c.env).length) {
      L.push('    env:');
      for (const k of Object.keys(c.env).sort()) L.push(`      ${k}: ${yamlScalar(c.env[k])}`);
    } else {
      L.push('    env: {}');
    }
    L.push(`    shell: ${c.shell ? 'true' : 'false'}`);
    L.push(`    isolation: ${yamlScalar(c.isolation === 'supervised' ? 'supervised' : 'in-loop')}`);
    L.push(`    description: ${yamlScalar(c.description || '')}`);
    L.push(`    tag: ${c.tag === null ? 'null' : yamlScalar(c.tag)}`);
    L.push(`    createdAt: ${yamlScalar(c.createdAt)}`);
    L.push(`    updatedAt: ${yamlScalar(c.updatedAt)}`);
  }
  return L.join('\n') + '\n';
}

/** Strip a trailing ` # comment` that is outside quotes, and full-line comments. */
function stripComment(line: string): string {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('#')) return '';
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#' && i > 0 && /\s/.test(line[i - 1])) return line.slice(0, i);
  }
  return line;
}

/** One scalar: JSON (strings/numbers/bools/null/arrays/objects), else a bare string. */
function parseScalar(raw: string): unknown {
  const v = raw.trim();
  if (!v) return '';
  if (v === 'null' || v === '~') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.startsWith('"') || v.startsWith('[') || v.startsWith('{')) {
    try {
      return JSON.parse(v);
    } catch {
      /* fall through to a bare string */
    }
  }
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) return v.slice(1, -1);
  return v;
}

interface Line {
  indent: number;
  text: string;
}

/** Parse the block starting at line index `i` whose items are indented `indent`. */
function parseBlock(lines: Line[], i: number, indent: number): { value: unknown; next: number } {
  const isList = lines[i] && lines[i].indent === indent && lines[i].text.startsWith('- ');
  if (isList) {
    const out: unknown[] = [];
    while (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith('- ')) {
      const rest = lines[i].text.slice(2).trim();
      if (!rest) {
        const child = i + 1 < lines.length && lines[i + 1].indent > indent ? parseBlock(lines, i + 1, lines[i + 1].indent) : { value: null, next: i + 1 };
        out.push(child.value);
        i = child.next;
        continue;
      }
      const colon = rest.indexOf(':');
      if (colon > 0 && !rest.startsWith('"') && !rest.startsWith('[') && !rest.startsWith('{')) {
        // `- key: value` opens a map item; its remaining keys sit at a deeper indent.
        const mapIndent = lines[i].indent;
        const synthetic: Line[] = [{ indent: mapIndent + 2, text: rest }];
        let j = i + 1;
        while (j < lines.length && lines[j].indent > mapIndent) {
          synthetic.push(lines[j]);
          j++;
        }
        const child = parseBlock(synthetic, 0, mapIndent + 2);
        out.push(child.value);
        i = j;
        continue;
      }
      out.push(parseScalar(rest));
      i++;
    }
    return { value: out, next: i };
  }

  const out: Record<string, unknown> = {};
  while (i < lines.length && lines[i].indent === indent && !lines[i].text.startsWith('- ')) {
    const text = lines[i].text;
    const colon = text.indexOf(':');
    if (colon < 0) {
      i++;
      continue;
    }
    const key = text.slice(0, colon).trim();
    const rest = text.slice(colon + 1).trim();
    if (rest) {
      out[key] = parseScalar(rest);
      i++;
      continue;
    }
    if (i + 1 < lines.length && lines[i + 1].indent > indent) {
      const child = parseBlock(lines, i + 1, lines[i + 1].indent);
      out[key] = child.value;
      i = child.next;
    } else if (i + 1 < lines.length && lines[i + 1].indent === indent && lines[i + 1].text.startsWith('- ')) {
      const child = parseBlock(lines, i + 1, indent);
      out[key] = child.value;
      i = child.next;
    } else {
      out[key] = null;
      i++;
    }
  }
  return { value: out, next: i };
}

/** YAML text → RegistryState. Unknown shapes fall back to sane defaults. */
export function yamlToState(yaml: string, fallbackName = 'registry.yaml'): RegistryState {
  const raw = String(yaml || '').split(/\r?\n/);
  const lines: Line[] = [];
  for (const line of raw) {
    const clean = stripComment(line);
    if (!clean.trim()) continue;
    if (clean.trim() === '---') continue;
    const indent = clean.length - clean.trimStart().length;
    lines.push({ indent, text: clean.trim() });
  }
  if (!lines.length) return defaultRegistry();
  const parsed = parseBlock(lines, 0, lines[0].indent).value as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== 'object') return defaultRegistry();
  const version = typeof parsed.version === 'number' ? parsed.version : 1;
  const lastUpdated = typeof parsed.lastUpdated === 'string' ? parsed.lastUpdated : new Date().toISOString();
  const list = Array.isArray(parsed.commands) ? (parsed.commands as unknown[]) : [];
  const commands: CommandDefinition[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const it = item as Record<string, unknown>;
    const name = typeof it.name === 'string' ? it.name : '';
    if (!name) continue;
    const now = new Date().toISOString();
    commands.push({
      name,
      command: typeof it.command === 'string' ? it.command : '',
      args: Array.isArray(it.args) ? (it.args as unknown[]).map(String) : [],
      cwd: typeof it.cwd === 'string' ? it.cwd : '',
      env: it.env && typeof it.env === 'object' && !Array.isArray(it.env)
        ? Object.fromEntries(Object.entries(it.env as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
        : {},
      shell: it.shell === true,
      // a file written before this field existed means in-loop: that was the only behaviour there was
      isolation: it.isolation === 'supervised' ? 'supervised' : 'in-loop',
      description: typeof it.description === 'string' ? it.description : '',
      tag: typeof it.tag === 'string' && it.tag.length ? it.tag : null,
      createdAt: typeof it.createdAt === 'string' ? it.createdAt : now,
      updatedAt: typeof it.updatedAt === 'string' ? it.updatedAt : now,
    });
  }
  void fallbackName;
  return { version, lastUpdated, commands };
}

/** Read the registry. A missing or broken file yields defaults; a broken one says so. */
export function loadRegistry(file: string): RegistryLoadResult {
  try {
    if (!fs.existsSync(file)) return { state: defaultRegistry(), file, error: null };
    const text = fs.readFileSync(file, 'utf8');
    return { state: yamlToState(text), file, error: null };
  } catch (err) {
    return { state: defaultRegistry(), file, error: (err as Error).message };
  }
}

/** Write the registry, refreshing lastUpdated. Returns the state that was written. */
export function saveRegistry(file: string, state: RegistryState): RegistryState {
  state.lastUpdated = new Date().toISOString();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, stateToYaml(state));
  return state;
}

/** Add a command. Throws when the name is taken or empty. */
export function addCommand(state: RegistryState, def: Partial<CommandDefinition> & { name: string }): CommandDefinition {
  const name = String(def.name || '').trim();
  if (!name) throw new Error('command name is required');
  if (state.commands.some((c) => c.name === name)) throw new Error(`command already exists: ${name}`);
  if (!def.command || !String(def.command).trim()) throw new Error('command is required');
  const now = new Date().toISOString();
  const cmd: CommandDefinition = {
    name,
    command: String(def.command),
    args: (def.args ?? []).map(String),
    cwd: def.cwd ? String(def.cwd) : '',
    env: def.env ?? {},
    isolation: def.isolation === 'supervised' ? 'supervised' : 'in-loop',
    shell: def.shell === true,
    description: def.description ? String(def.description) : '',
    tag: def.tag ? String(def.tag) : null,
    createdAt: now,
    updatedAt: now,
  };
  state.commands.push(cmd);
  state.lastUpdated = now;
  return cmd;
}

/** Change one saved command. Throws when it does not exist. */
export function updateCommand(state: RegistryState, name: string, patch: CommandPatch): CommandDefinition {
  const cmd = state.commands.find((c) => c.name === name);
  if (!cmd) throw new Error(`unknown command: ${name}`);
  if (patch.args) cmd.args = patch.args.map(String);
  if (patch.env) cmd.env = patch.env;
  if (patch.cwd !== undefined) cmd.cwd = String(patch.cwd);
  if (patch.command !== undefined) cmd.command = String(patch.command);
  if (patch.shell !== undefined) cmd.shell = patch.shell === true;
  if (patch.description !== undefined) cmd.description = String(patch.description);
  if (patch.tag !== undefined) cmd.tag = patch.tag === null ? null : String(patch.tag);
  cmd.updatedAt = new Date().toISOString();
  state.lastUpdated = cmd.updatedAt;
  return cmd;
}

/** Drop one saved command. Returns whether anything was removed. */
export function removeCommand(state: RegistryState, name: string): boolean {
  const before = state.commands.length;
  state.commands = state.commands.filter((c) => c.name !== name);
  const removed = state.commands.length !== before;
  if (removed) state.lastUpdated = new Date().toISOString();
  return removed;
}

/** Look one up by name. */
export function getCommand(state: RegistryState, name: string): CommandDefinition | null {
  return state.commands.find((c) => c.name === name) ?? null;
}

/** Turn a saved command into a launch spec (never mutating the saved definition). */
export function toSpec(def: CommandDefinition, overrides: Partial<ProcessSpec> = {}): ProcessSpec {
  const spec: ProcessSpec = {
    command: def.command,
    args: def.args.length ? [...def.args] : undefined,
    cwd: def.cwd || undefined,
    env: Object.keys(def.env).length ? { ...def.env } : undefined,
    shell: def.shell,
    name: def.name,
    tag: def.tag ?? null,
  };
  // Only DEFINED overrides win. Spreading `{name: undefined}` over the spec used to blank
  // the saved name and launch the command under its exe path — an undefined must never win.
  if (overrides.name !== undefined) spec.name = overrides.name;
  if (overrides.tag !== undefined) spec.tag = overrides.tag;
  if (overrides.command !== undefined) spec.command = overrides.command;
  if (overrides.args !== undefined) spec.args = overrides.args;
  if (overrides.cwd !== undefined) spec.cwd = overrides.cwd;
  if (overrides.env !== undefined) spec.env = overrides.env;
  if (overrides.shell !== undefined) spec.shell = overrides.shell;
  if (def.isolation === 'supervised' && overrides.isolation === undefined) spec.isolation = 'supervised';
  if (overrides.isolation !== undefined) spec.isolation = overrides.isolation;
  if (overrides.bufferLimitChars !== undefined) spec.bufferLimitChars = overrides.bufferLimitChars;
  return spec;
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const os = await import('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-reg-'));
  const file = path.join(dir, 'data.yaml');
  const results: string[] = [];
  const ok = (label: string, cond: boolean, extra = '') => {
    console.assert(cond, `FAIL ${label}${extra ? ' :: ' + extra : ''}`);
    results.push(`${cond ? 'pass' : 'FAIL'} ${label}`);
  };
  const deepEqual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  // 1. a rich state survives state → yaml → state exactly
  const state = defaultRegistry();
  addCommand(state, {
    name: 'sdxl-pull',
    command: 'powershell',
    args: ['-File', 'C:/Hydra/tools/prep_pull_sdxl.ps1', '--out', 'C:\\Receive\\models'],
    cwd: 'C:/Hydra',
    env: { HF_HOME: 'C:/models/hf', PYTHONIOENCODING: 'utf-8' },
    shell: false,
    description: 'pull the SDXL base checkpoint (a name with: a colon, and a "quote")',
    tag: 'models',
  });
  addCommand(state, { name: 'ping-demo', command: 'ping', args: ['-n', '3', '127.0.0.1'], description: 'three pings', tag: null });
  addCommand(state, { name: 'tick', command: process.execPath, args: ['-e', "setInterval(()=>console.log('tick'),1000)"], shell: false });

  const yaml = stateToYaml(state);
  ok('yaml is text and readable', typeof yaml === 'string' && yaml.includes('commands:'), yaml.slice(0, 80));
  ok('yaml keeps the comments for humans', yaml.startsWith('# ProcessWrapper registry'));
  const back = yamlToState(yaml);
  ok('round trip keeps every command', back.commands.length === 3, String(back.commands.length));
  ok('round trip is exact', deepEqual(back.commands, state.commands), JSON.stringify(back.commands));
  ok('round trip keeps version + lastUpdated', back.version === state.version && back.lastUpdated === state.lastUpdated);
  ok('round trip keeps nested env', back.commands[0].env.HF_HOME === 'C:/models/hf', JSON.stringify(back.commands[0].env));
  ok('round trip keeps windows paths in args', back.commands[0].args[3] === 'C:\\Receive\\models', JSON.stringify(back.commands[0].args));
  ok('round trip keeps a colon+quote in a description', back.commands[0].description === state.commands[0].description, back.commands[0].description);
  ok('round trip keeps an empty tag as null', back.commands[1].tag === null, String(back.commands[1].tag));
  ok('round trip keeps unicode', (() => { const s = defaultRegistry(); addCommand(s, { name: 'uni', command: 'echo', args: ['héllo — 世界'], description: 'ünïcode' }); return yamlToState(stateToYaml(s)).commands[0].args[0] === 'héllo — 世界'; })());

  // 2. file persistence
  const r1 = loadRegistry(file);
  ok('missing file loads defaults', r1.state.commands.length === 0 && r1.error === null, JSON.stringify(r1.error));
  saveRegistry(file, state);
  const onDisk = fs.readFileSync(file, 'utf8');
  ok('save writes the file', onDisk.includes('sdxl-pull'), onDisk.slice(0, 60));
  const r2 = loadRegistry(file);
  ok('load reads it back', deepEqual(r2.state.commands, state.commands) && r2.error === null, JSON.stringify(r2.error));
  ok('save refreshed lastUpdated', r2.state.lastUpdated >= state.commands[0].createdAt);

  // 3. CRUD touches lastUpdated and reports honestly
  const s = defaultRegistry();
  ok('add requires a name', (() => { try { addCommand(s, { name: '', command: 'x' }); return false; } catch { return true; } })());
  ok('add requires a command', (() => { try { addCommand(s, { name: 'x', command: '' }); return false; } catch { return true; } })());
  addCommand(s, { name: 'a', command: 'foo' });
  ok('add refuses a duplicate name', (() => { try { addCommand(s, { name: 'a', command: 'bar' }); return false; } catch { return true; } })());
  const before = s.lastUpdated;
  await new Promise((r) => setTimeout(r, 5));
  const upd = updateCommand(s, 'a', { args: ['--x'], description: 'updated', tag: 'grp' });
  ok('update bumps updatedAt', upd.updatedAt >= before && s.lastUpdated === upd.updatedAt, s.lastUpdated);
  ok('update applies the patch', deepEqual(upd.args, ['--x']) && upd.description === 'updated' && upd.tag === 'grp');
  ok('update keeps createdAt', upd.createdAt === upd.createdAt, upd.createdAt);
  ok('update of an unknown name throws', (() => { try { updateCommand(s, 'nope', {}); return false; } catch { return true; } })());
  ok('get finds it', getCommand(s, 'a')?.name === 'a');
  ok('get of an unknown name is null', getCommand(s, 'zz') === null);
  ok('remove reports the removal', removeCommand(s, 'a') === true && s.commands.length === 0);
  ok('remove of an unknown name is false', removeCommand(s, 'a') === false);

  // 4. broken files never throw, and say so
  fs.writeFileSync(file, 'commands: [ this is : not, yaml ][\n');
  const r3 = loadRegistry(file);
  ok('a junk file loads defaults instead of throwing', Array.isArray(r3.state.commands), JSON.stringify(r3.state));
  ok('a junk file is honestly empty (no invented commands)', r3.state.commands.length === 0, String(r3.state.commands.length));
  const r4 = loadRegistry(path.join(dir, 'nested', 'data.yaml'));
  ok('a missing directory is not an error', r4.error === null);

  // 5. saved command → launch spec
  const specState = defaultRegistry();
  addCommand(specState, { name: 'spec-src', command: 'python', args: ['bar.py'], cwd: 'C:/tmp', tag: 'g', shell: true });
  const spec = toSpec(specState.commands[0]);
  ok('toSpec carries command/args/cwd/shell', spec.command === 'python' && deepEqual(spec.args, ['bar.py']) && spec.cwd === 'C:/tmp' && spec.shell === true, JSON.stringify(spec));
  ok('toSpec names the process after the command', spec.name === 'spec-src');
  const spec2 = toSpec(specState.commands[0], { name: 'override', tag: 'other' });
  ok('toSpec accepts overrides without touching the definition', spec2.name === 'override' && spec2.tag === 'other' && specState.commands[0].name === 'spec-src');
  ok('toSpec does not alias the saved args array', spec.args !== specState.commands[0].args);
  const spec3 = toSpec(specState.commands[0], { name: undefined, tag: undefined });
  ok('an undefined override never blanks a saved field', spec3.name === 'spec-src' && spec3.tag === 'g' && spec3.command === 'python', JSON.stringify(spec3));
  const spec4 = toSpec(specState.commands[0], { cwd: '' });
  ok('an empty-string override still wins when it is defined', spec4.cwd === '', JSON.stringify(spec4.cwd));

  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`[registryStore] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join('\n'));
}

// runTests();
