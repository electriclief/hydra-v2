/**
 * @module registry
 * @description The wrapper's typed-entry registry. Register a TAB (name + path — where
 *              the page answers; spot/meta optional) or a MENU (label + items, each item
 *              a label→function hand). Upsert by key: a tab by its name, a menu by its
 *              id. Subscribers hear every register/update/unregister. Boots BLANK — it
 *              knows nothing until something registers, and it decides nothing about what
 *              was handed in beyond keeping the wrapper's own house (a tab needs a name
 *              and a path; a menu needs an id, a label and an items array).
 * @intent The same generic as State: "defined by registration after run start". The
 *         wrapper watches and renders; the data and the logic stay outside.
 */

// --- Interface Definitions ---

export interface TabEntry {
  type: 'tab';
  name: string;
  path: string;
  spot?: string;
  closable?: boolean;
  meta?: Record<string, unknown>;
}

export interface MenuItemDef {
  label?: string;
  id?: string;
  type?: 'normal' | 'separator';
  /** The host's own hand — called on click, alongside the event that goes out. */
  onClick?: () => void;
  enabled?: boolean;
  checked?: boolean;
  submenu?: MenuItemDef[];
}

export interface MenuEntry {
  type: 'menu';
  id: string;
  label: string;
  items: MenuItemDef[];
}

export type WrapperEntry = TabEntry | MenuEntry;
export type EntryKind = 'tab' | 'menu';

export interface RegistryChange {
  kind: 'register' | 'update' | 'unregister';
  entryKind: EntryKind;
  key: string;
}

export interface WrapperRegistry {
  /** Validate + upsert; returns the canonical entry that now lives in the registry. */
  register(entry: unknown): WrapperEntry;
  /** Pop an entry; returns whether it was there. */
  unregister(entryKind: EntryKind, key: string): boolean;
  tabs(): TabEntry[];
  menus(): MenuEntry[];
  list(): { tabs: TabEntry[]; menus: MenuEntry[] };
  getTab(name: string): TabEntry | undefined;
  getMenu(id: string): MenuEntry | undefined;
  subscribe(fn: (change: RegistryChange) => void): () => void;
  size(): number;
}

// --- Function Definitions ---

function fail(what: string): never {
  throw new Error(`registration refused: ${what}`);
}

function canonicalTab(raw: unknown): TabEntry {
  if (typeof raw !== 'object' || raw === null) fail('a tab must be an object');
  const t = raw as Partial<TabEntry>;
  if (typeof t.name !== 'string' || t.name.trim() === '') fail('a tab needs a name');
  if (typeof t.path !== 'string' || t.path.trim() === '') fail(`tab "${t.name}" needs a path (the address its page answers at)`);
  const entry: TabEntry = { type: 'tab', name: t.name.trim(), path: t.path.trim() };
  if (typeof t.spot === 'string' && t.spot.trim() !== '') entry.spot = t.spot.trim();
  if (t.closable !== undefined) entry.closable = Boolean(t.closable);
  if (t.meta !== undefined) entry.meta = t.meta as Record<string, unknown>;
  return entry;
}

function canonicalItem(raw: unknown, trail: string): MenuItemDef {
  if (typeof raw !== 'object' || raw === null) fail(`menu item ${trail} must be an object`);
  const it = raw as Partial<MenuItemDef>;
  if (it.type === 'separator') return { type: 'separator' };
  if (typeof it.label !== 'string' || it.label.trim() === '') fail(`menu item ${trail} needs a label`);
  const out: MenuItemDef = { label: it.label };
  if (typeof it.id === 'string') out.id = it.id;
  if (typeof it.onClick === 'function') out.onClick = it.onClick;
  if (it.enabled !== undefined) out.enabled = Boolean(it.enabled);
  if (it.checked !== undefined) out.checked = Boolean(it.checked);
  if (it.submenu !== undefined) {
    if (!Array.isArray(it.submenu)) fail(`menu item ${trail} submenu must be an array`);
    out.submenu = it.submenu.map((child, i) => canonicalItem(child, `${trail} > ${i}`));
  }
  return out;
}

function canonicalMenu(raw: unknown): MenuEntry {
  if (typeof raw !== 'object' || raw === null) fail('a menu must be an object');
  const m = raw as Partial<MenuEntry>;
  if (typeof m.id !== 'string' || m.id.trim() === '') fail('a menu needs an id');
  if (typeof m.label !== 'string' || m.label.trim() === '') fail(`menu "${m.id}" needs a label`);
  if (!Array.isArray(m.items)) fail(`menu "${m.id}" needs an items array`);
  return {
    type: 'menu',
    id: m.id.trim(),
    label: m.label,
    items: m.items.map((it, i) => canonicalItem(it, `${m.id} > ${i}`)),
  };
}

export function canonicalEntry(raw: unknown): WrapperEntry {
  if (typeof raw !== 'object' || raw === null) fail('not an object');
  const type = (raw as { type?: unknown }).type;
  if (type === 'tab') return canonicalTab(raw);
  if (type === 'menu') return canonicalMenu(raw);
  fail(`unknown entry type "${String(type)}" (a tab or a menu)`);
}

export function createWrapperRegistry(): WrapperRegistry {
  const tabMap = new Map<string, TabEntry>();
  const menuMap = new Map<string, MenuEntry>();
  const subscribers = new Set<(change: RegistryChange) => void>();

  const notify = (change: RegistryChange): void => {
    for (const fn of [...subscribers]) {
      try {
        fn(change);
      } catch (err) {
        console.warn('[Electron_Wrapper] a registry subscriber threw (isolated):', err);
      }
    }
  };

  const compareTabs = (a: TabEntry, b: TabEntry): boolean => JSON.stringify(a) === JSON.stringify(b);

  return {
    register(raw: unknown): WrapperEntry {
      const entry = canonicalEntry(raw);
      if (entry.type === 'tab') {
        const prev = tabMap.get(entry.name);
        if (prev && compareTabs(prev, entry)) return prev; // identical hand-in — no-op
        tabMap.set(entry.name, entry);
        notify({ kind: prev ? 'update' : 'register', entryKind: 'tab', key: entry.name });
        return entry;
      }
      const prev = menuMap.get(entry.id);
      menuMap.set(entry.id, entry);
      notify({ kind: prev ? 'update' : 'register', entryKind: 'menu', key: entry.id });
      return entry;
    },

    unregister(entryKind: EntryKind, key: string): boolean {
      const found = entryKind === 'tab' ? tabMap.delete(key) : menuMap.delete(key);
      if (found) notify({ kind: 'unregister', entryKind, key });
      return found;
    },

    tabs(): TabEntry[] {
      return [...tabMap.values()];
    },
    menus(): MenuEntry[] {
      return [...menuMap.values()];
    },
    list() {
      return { tabs: this.tabs(), menus: this.menus() };
    },
    getTab(name: string): TabEntry | undefined {
      return tabMap.get(name);
    },
    getMenu(id: string): MenuEntry | undefined {
      return menuMap.get(id);
    },
    subscribe(fn: (change: RegistryChange) => void): () => void {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    size(): number {
      return tabMap.size + menuMap.size;
    },
  };
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const ok = (label: string, cond: boolean, extra = ''): void => {
    console.assert(cond, `FAIL registry :: ${label}${extra ? ' :: ' + extra : ''}`);
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

  const r = createWrapperRegistry();
  ok('boots blank', r.size() === 0);

  const changes: string[] = [];
  const unsub = r.subscribe((c) => changes.push(`${c.kind}:${c.entryKind}:${c.key}`));

  const tab = r.register({ type: 'tab', name: 'Comfy A', path: 'localhost:8188' });
  ok('a tab registers', tab.type === 'tab' && tab.name === 'Comfy A');
  ok('the change is heard', changes.at(-1) === 'register:tab:Comfy A');

  r.register({ type: 'tab', name: 'Comfy A', path: 'localhost:8188' });
  ok('an identical re-hand is a no-op', changes.length === 1);

  r.register({ type: 'tab', name: 'Comfy A', path: 'localhost:8189' });
  ok('a changed re-hand is an update', changes.at(-1) === 'update:tab:Comfy A');
  ok('the path was replaced', r.getTab('Comfy A')?.path === 'localhost:8189');

  r.register({ type: 'tab', name: 'Comfy B', path: '192.168.1.50:8188', spot: 'side' });
  ok('a second tab lands', r.tabs().length === 2);
  ok('spot rides along', r.getTab('Comfy B')?.spot === 'side');

  const menu = r.register({ type: 'menu', id: 'file', label: 'File', items: [{ label: 'Load', onClick: () => undefined }] });
  ok('a menu registers', menu.type === 'menu' && r.getMenu('file')?.label === 'File');
  ok('tabs and menus stay separate kinds', r.tabs().length === 2 && r.menus().length === 1);

  ok('unregister pops', r.unregister('tab', 'Comfy B') === true && r.tabs().length === 1);
  ok('unregister of a ghost is false', r.unregister('tab', 'Comfy B') === false);

  unsub();
  r.register({ type: 'tab', name: 'Quiet', path: 'x:1' });
  ok('unsubscribed ears hear nothing more', !changes.some((c) => c.includes('Quiet')));

  throws('a tab without a name is refused', () => r.register({ type: 'tab', path: 'x' }));
  throws('a tab without a path is refused', () => r.register({ type: 'tab', name: 'x' }));
  throws('a menu without items is refused', () => r.register({ type: 'menu', id: 'm', label: 'M' }));
  throws('an unknown type is refused', () => r.register({ type: 'thing', name: 'x' }));
  throws('a labelled menu item without a label is refused', () =>
    r.register({ type: 'menu', id: 'm', label: 'M', items: [{ type: 'normal' }] }),
  );

  const sep = r.register({
    type: 'menu',
    id: 'm2',
    label: 'M2',
    items: [{ type: 'separator' }, { label: 'A', submenu: [{ label: 'B' }] }],
  });
  ok(
    'separators and submenus survive canonicalization',
    sep.type === 'menu' && sep.items[0].type === 'separator' && sep.items[1].submenu?.[0].label === 'B',
  );
}
