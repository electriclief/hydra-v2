/**
 * @module roster
 * @description The DECLARED fleet — the file that answers "what is this machine FOR", kept apart from
 *              what Join already does for things that are here. A door on this shelf resolves a NAME to
 *              a thing that IS running; this resolves a name to a machine the operator has declared,
 *              whether or not it is answering right now. Two different facts, never merged: `attached`
 *              is measured, `role`/`ready_for` are declared.
 * @intent One roster where every machine carries its role and the capabilities it was bought for, so a
 *              lookup by name never says "not found" for a box that is merely asleep.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface RosterRow {
  readonly name: string;
  readonly ip: string | null;
  /** the State door this machine answers on - a name without an address is not resolvable */
  readonly door: number | null;
  readonly hostname: string | null;
  readonly role: string | null;
  readonly ready_for: readonly string[];
  readonly notes: string;
  readonly enabled: boolean;
  readonly kind: 'controller' | 'node';
}

export interface Roster {
  readonly ok: boolean;
  readonly file: string;
  readonly error: string | null;
  readonly rows: readonly RosterRow[];
}

/** The controller's own row lives beside `nodes`, because the controller is a machine with a role too. */
export const DEFAULT_ROSTER = process.env.JOIN_ROSTER ?? 'C:/AI/fleet/roster.json';

function asRow(raw: unknown, kind: 'controller' | 'node'): RosterRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === 'string' ? r.name.trim() : '';
  const ip = typeof r.ip === 'string' ? r.ip.trim() : null;
  if (!name && !ip) return null;
  return {
    name: name || String(ip),
    ip,
    door: Number.isFinite(Number(r.door)) ? Number(r.door) : null,
    hostname: typeof r.hostname === 'string' ? r.hostname.trim() : null,
    role: typeof r.role === 'string' && r.role.trim() ? r.role.trim() : null,
    ready_for: Array.isArray(r.ready_for) ? r.ready_for.filter((v): v is string => typeof v === 'string' && v.trim().length > 0) : [],
    notes: typeof r.notes === 'string' ? r.notes : '',
    enabled: r.enabled !== false,
    kind,
  };
}

/**
 * Read the declared roster. An unreadable roster is a FACT in the answer (ok:false plus the path it tried),
 * never an exception: a resolver that throws cannot say why it has nothing.
 */
export function loadRoster(file: string = DEFAULT_ROSTER): Roster {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  } catch (error) {
    const e = error as NodeJS.ErrnoException;
    return { ok: false, file, error: e.code === 'ENOENT' ? 'not found' : e.message, rows: [] };
  }
  if (!raw || typeof raw !== 'object') return { ok: false, file, error: 'not a JSON object', rows: [] };
  const body = raw as Record<string, unknown>;
  const rows: RosterRow[] = [];
  const controller = asRow(body.controller, 'controller');
  if (controller) rows.push(controller);
  for (const node of Array.isArray(body.nodes) ? body.nodes : []) {
    const row = asRow(node, 'node');
    if (row) rows.push(row);
  }
  return { ok: true, file, error: null, rows };
}

/** One declared machine by name (case-insensitive), or by ip when the caller knows only the address. */
export function resolveDeclared(roster: Roster, name: string): RosterRow | null {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  for (const row of roster.rows) {
    if (row.name.toLowerCase() === wanted || (row.ip ?? '') === wanted || (row.hostname ?? '').toLowerCase() === wanted) return row;
  }
  return null;
}

/** The gate: real files on a real temp path, because "the role is missing" is nearly always a bad path. */
export function runTests(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'join-roster-'));
  const file = path.join(dir, 'roster.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      controller: { name: '123', ip: '192.168.1.123', role: 'controller', ready_for: ['doors'] },
      nodes: [
        { name: 'jims', ip: '192.168.1.127', door: 8127, hostname: 'DESKTOP-DC6TMU5', role: 'main', ready_for: ['tts', 'llm-small'] },
        { name: 'off', ip: '192.168.1.150', role: 'gpu', ready_for: [], enabled: false },
      ],
    }),
    'utf8',
  );
  const roster = loadRoster(file);
  console.assert(roster.ok === true, 'a real roster file loads');
  console.assert(roster.rows.length === 3, 'the controller is a row like any other', String(roster.rows.length));
  console.assert(roster.rows[0].kind === 'controller', 'the controller row says so');
  console.assert(roster.rows[1].ready_for.includes('tts'), 'ready_for survives the read');
  console.assert(roster.rows[2].enabled === false, 'a disabled row is kept, not dropped');
  console.assert(roster.rows[1].door === 8127, 'a row carries the door it answers on', String(roster.rows[1].door));
  console.assert(roster.rows[2].door === null, 'a row without a door says null, not 0', String(roster.rows[2].door));

  const missing = loadRoster(path.join(dir, 'nope.json'));
  console.assert(missing.ok === false, 'an unreadable roster is a fact, not an exception');
  console.assert(String(missing.error).length > 0, 'and it says why');
  console.assert(missing.rows.length === 0, 'and holds no invented rows');

  console.assert(resolveDeclared(roster, 'JIMS')?.role === 'main', 'a name resolves case-insensitively');
  console.assert(resolveDeclared(roster, '192.168.1.150')?.name === 'off', 'an ip resolves to its row');
  console.assert(resolveDeclared(roster, 'desktop-dc6tmu5')?.name === 'jims', 'a hostname resolves to its row');
  console.assert(resolveDeclared(roster, 'nobody') === null, 'an undeclared name resolves to nothing, never a guess');
  console.assert(resolveDeclared(roster, '   ') === null, 'an empty name is not a name');

  fs.rmSync(dir, { recursive: true, force: true });
}
