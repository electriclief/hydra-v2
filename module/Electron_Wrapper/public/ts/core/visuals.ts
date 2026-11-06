/**
 * @module visuals
 * @description A tab's presentation state, mirrored from the State module: SOLID (the
 *              silent default) · HIGHLIGHTED (wants a look) · FLASHING (expecting
 *              input). `normalizeVisual` reads whatever shape the state entry took;
 *              `autoSelect` answers the operator's rule — if only ONE tab is flashing,
 *              that tab auto-selects.
 * @intent The wrapper only reflects: owners change their own state; viewing clears
 *         nothing. The wrapper pulls, matches state logic, and shows.
 */

// --- Interface Definitions ---

export type TabVisual = 'solid' | 'highlighted' | 'flashing';

export interface TabVisualEntry {
  name: string;
  visual: TabVisual;
}

// --- Function Definitions ---

function fromString(value: string): TabVisual {
  const v = value.toLowerCase();
  if (v.includes('flash')) return 'flashing';
  if (v.includes('high') || v.includes('activ') || v.includes('warn') || v.includes('wait')) return 'highlighted';
  return 'solid';
}

/**
 * Tolerant read — the registrant's state entry may be a plain string ("flashing"),
 * or an object: {state|visual|status: '…'} · {flashing: true} · {highlighted: true} ·
 * {input: true} (expecting input → flashing). Anything unknown reads as solid.
 */
export function normalizeVisual(value: unknown): TabVisual {
  if (typeof value === 'string') return fromString(value);
  if (typeof value === 'object' && value !== null) {
    const o = value as Record<string, unknown>;
    if (o.flashing === true || o.expectingInput === true || o.input === true) return 'flashing';
    if (o.highlighted === true || o.active === true) return 'highlighted';
    for (const key of ['state', 'visual', 'status'] as const) {
      const inner = o[key];
      if (typeof inner === 'string') return fromString(inner);
    }
    if (typeof o.value === 'string') return fromString(o.value);
  }
  return 'solid';
}

/** The CSS class a visual rides with (applied alongside the pane's own classes). */
export function visualClass(visual: TabVisual): string {
  return `ew-tab--${visual}`;
}

/**
 * The operator's rule: if only one tab is flashing it auto-selects; zero or several
 * flashing tabs decide nothing (the wrapper never guesses).
 */
export function autoSelect(entries: TabVisualEntry[]): string | null {
  const flashing = entries.filter((e) => e.visual === 'flashing');
  return flashing.length === 1 ? flashing[0].name : null;
}

/** Apply a raw state snapshot ({name: value}) onto a tab-name list. */
export function applySnapshot(names: string[], snapshot: Record<string, unknown>): TabVisualEntry[] {
  return names.map((name) => ({ name, visual: normalizeVisual(snapshot[name]) }));
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const ok = (label: string, cond: boolean, extra = ''): void => {
    console.assert(cond, `FAIL visuals :: ${label}${extra ? ' :: ' + extra : ''}`);
  };

  ok('a plain string reads', normalizeVisual('flashing') === 'flashing');
  ok('case does not matter', normalizeVisual('Highlighted') === 'highlighted');
  ok('solid reads solid', normalizeVisual('solid') === 'solid');
  ok('"active" reads highlighted', normalizeVisual('active') === 'highlighted');
  ok('a boolean shape reads flashing', normalizeVisual({ flashing: true }) === 'flashing');
  ok('expecting input reads flashing', normalizeVisual({ input: true }) === 'flashing');
  ok('a state field reads', normalizeVisual({ state: 'flashing' }) === 'flashing');
  ok('a visual field reads', normalizeVisual({ visual: 'highlighted' }) === 'highlighted');
  ok('a value field reads', normalizeVisual({ value: 'flashing' }) === 'flashing');
  ok('unknown reads solid', normalizeVisual({ junk: 1 }) === 'solid');
  ok('undefined reads solid', normalizeVisual(undefined) === 'solid');
  ok('null reads solid', normalizeVisual(null) === 'solid');

  ok('the class follows the name', visualClass('flashing') === 'ew-tab--flashing');
  ok('the class follows the name (highlighted)', visualClass('highlighted') === 'ew-tab--highlighted');

  const lone = autoSelect([
    { name: 'a', visual: 'solid' },
    { name: 'b', visual: 'flashing' },
    { name: 'c', visual: 'highlighted' },
  ]);
  ok('a lone flashing tab auto-selects', lone === 'b');
  ok(
    'several flashing tabs decide nothing',
    autoSelect([
      { name: 'a', visual: 'flashing' },
      { name: 'b', visual: 'flashing' },
    ]) === null,
  );
  ok('zero flashing tabs decide nothing', autoSelect([{ name: 'a', visual: 'solid' }]) === null);

  const applied = applySnapshot(['a', 'b'], { a: 'flashing', b: { state: 'highlighted' } });
  ok('a snapshot applies onto the names', applied[0].visual === 'flashing' && applied[1].visual === 'highlighted');
  ok('a name missing from the snapshot reads solid', applySnapshot(['x'], {})[0].visual === 'solid');
}
