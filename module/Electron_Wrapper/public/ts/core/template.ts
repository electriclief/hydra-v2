/**
 * @module template
 * @description The template as pure data: SPOTS for tab insertions, and how the root
 *              arranges them (row | column). Normalizes + validates; the default is one
 *              full spot ("main"). `buildLayout` composes the neutral arrangement the
 *              renderer hands to Golden Layout — the Golden Layout dialect itself lives
 *              ONLY in the renderer, so the layout library under us stays swappable.
 * @intent "a template that allows a spot(s) for tab insertions and boom — its done."
 *         The template is outside data; changing the face never touches code.
 */

import type { TabEntry } from './registry.js';
import type { TabVisual } from './visuals.js';

// --- Interface Definitions ---

export interface SpotDef {
  id: string;
  title?: string;
}

export interface TemplateDef {
  spots: SpotDef[];
  arrangement: 'row' | 'column';
  defaultSpot: string;
  title?: string;
}

export interface PaneView {
  name: string;
  title: string;
  url: string;
  visual: TabVisual;
  closable: boolean;
  spot: string;
}

export interface PaneNode {
  type: 'component';
  componentType: 'ew-tab';
  name: string;
  title: string;
  url: string;
  visual: TabVisual;
  closable: boolean;
}

export interface StackNode {
  type: 'stack';
  id: string;
  title?: string;
  content: PaneNode[];
}

export interface RootNode {
  type: 'row' | 'column';
  id: 'root';
  content: StackNode[];
}

export interface LayoutDef {
  root: RootNode;
}

// --- Function Definitions ---

export const DEFAULT_TEMPLATE: TemplateDef = {
  spots: [{ id: 'main', title: 'Main' }],
  arrangement: 'column',
  defaultSpot: 'main',
};

export function normalizeTemplate(raw: unknown): TemplateDef {
  if (raw === undefined || raw === null) return structuredClone(DEFAULT_TEMPLATE);
  if (typeof raw !== 'object') throw new Error('template refused: not an object');
  const t = raw as Partial<TemplateDef>;
  if (!Array.isArray(t.spots) || t.spots.length === 0) throw new Error('template refused: needs at least one spot');
  const spots: SpotDef[] = t.spots.map((s, i) => {
    if (typeof s !== 'object' || s === null) throw new Error(`template refused: spot ${i} is not an object`);
    const spot = s as Partial<SpotDef>;
    if (typeof spot.id !== 'string' || spot.id.trim() === '') throw new Error(`template refused: spot ${i} needs an id`);
    const out: SpotDef = { id: spot.id.trim() };
    if (typeof spot.title === 'string') out.title = spot.title;
    return out;
  });
  const seen = new Set<string>();
  for (const s of spots) {
    if (seen.has(s.id)) throw new Error(`template refused: duplicate spot id "${s.id}"`);
    seen.add(s.id);
  }
  const arrangement = t.arrangement === 'row' ? 'row' : 'column';
  let defaultSpot = typeof t.defaultSpot === 'string' ? t.defaultSpot.trim() : spots[0].id;
  if (!seen.has(defaultSpot)) throw new Error(`template refused: defaultSpot "${defaultSpot}" is not a spot`);
  const out: TemplateDef = { spots, arrangement, defaultSpot };
  if (typeof t.title === 'string') out.title = t.title;
  return out;
}

/** Where a tab lands: its own spot when it named one that exists, else the default. */
export function spotFor(template: TemplateDef, tab: TabEntry): string {
  if (tab.spot !== undefined) {
    if (template.spots.some((s) => s.id === tab.spot)) return tab.spot;
    console.warn(`[Electron_Wrapper] tab "${tab.name}" asked for spot "${tab.spot}" — not in the template; defaulting to "${template.defaultSpot}"`);
  }
  return template.defaultSpot;
}

/** Compose the neutral arrangement: one stack per spot (template order), panes inside. */
export function buildLayout(template: TemplateDef, panes: PaneView[]): LayoutDef {
  const stacks: StackNode[] = template.spots.map((spot) => ({
    type: 'stack' as const,
    id: spot.id,
    ...(spot.title !== undefined ? { title: spot.title } : {}),
    content: panes
      .filter((p) => p.spot === spot.id)
      .map((p) => ({
        type: 'component' as const,
        componentType: 'ew-tab' as const,
        name: p.name,
        title: p.title,
        url: p.url,
        visual: p.visual,
        closable: p.closable,
      })),
  }));
  return { root: { type: template.arrangement, id: 'root', content: stacks } };
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const ok = (label: string, cond: boolean, extra = ''): void => {
    console.assert(cond, `FAIL template :: ${label}${extra ? ' :: ' + extra : ''}`);
  };
  const throws = (label: string, fn: () => unknown): void => {
    let threw = false;
    try {
      fn();
    } catch {
      threw = true;
    }
    ok(label, threw);
  };

  const def = normalizeTemplate(undefined);
  ok('no template lands the single main spot', def.spots.length === 1 && def.defaultSpot === 'main' && def.arrangement === 'column');

  const two = normalizeTemplate({
    spots: [{ id: 'main', title: 'Main' }, { id: 'side' }],
    arrangement: 'row',
    defaultSpot: 'side',
  });
  ok('a two-spot template normalizes', two.spots.length === 2 && two.arrangement === 'row' && two.defaultSpot === 'side');
  ok('spot titles survive', two.spots[0].title === 'Main');

  throws('a template without spots is refused', () => normalizeTemplate({ spots: [] }));
  throws('a duplicate spot id is refused', () => normalizeTemplate({ spots: [{ id: 'a' }, { id: 'a' }] }));
  throws('a defaultSpot that is not a spot is refused', () => normalizeTemplate({ spots: [{ id: 'a' }], defaultSpot: 'ghost' }));

  const tabA = { type: 'tab' as const, name: 'A', path: 'localhost:1' };
  const tabS = { type: 'tab' as const, name: 'S', path: 'localhost:2', spot: 'side' };
  const tabGhost = { type: 'tab' as const, name: 'G', path: 'localhost:3', spot: 'ghost' };
  ok('a tab without a spot goes to the default', spotFor(two, tabA) === 'side');
  ok('a tab naming a real spot goes there', spotFor(two, tabS) === 'side');
  ok('a tab naming a ghost spot falls back to the default', spotFor(two, tabGhost) === 'side');

  const panes: PaneView[] = [
    { name: 'A', title: 'A', url: 'http://localhost:1', visual: 'solid', closable: true, spot: 'main' },
    { name: 'S', title: 'S', url: 'http://localhost:2', visual: 'flashing', closable: false, spot: 'side' },
  ];
  const layout = buildLayout(two, panes);
  ok('the root takes the arrangement', layout.root.type === 'row');
  ok('one stack per spot, in template order', layout.root.content.length === 2 && layout.root.content[0].id === 'main' && layout.root.content[1].id === 'side');
  ok('panes land in their spot stack', layout.root.content[0].content.length === 1 && layout.root.content[0].content[0].name === 'A');
  ok('the second stack holds the second pane', layout.root.content[1].content[0].name === 'S');
  const node = layout.root.content[1].content[0];
  ok('a pane node carries the whole view', node.componentType === 'ew-tab' && node.url === 'http://localhost:2' && node.visual === 'flashing' && node.closable === false);
  const empty = buildLayout(two, []);
  ok('empty spots still stand as places to insert', empty.root.content.every((s) => s.content.length === 0));
}
