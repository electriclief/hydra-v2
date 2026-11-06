/**
 * @module renderer/app
 * @description The wrapper page's machine. The Golden Layout dialect lives HERE only —
 *              the neutral arrangement (spots + panes) arrives from the main process as
 *              plain data, and this file is the thin glue that maps it onto GL2: one
 *              stack per spot, one component per tab, each tab a div/iframe to its
 *              registered address. Visual states ride as CSS classes (solid ·
 *              highlighted · flashing); tab activations and closes go OUT via the
 *              preload bridge. The page never learns what a tab renders.
 * @intent "A tab (really just a div) … which just reads an api rendered endpoint —
 *         so it is basically mapping iframes." Swapping the layout library under us
 *         later must touch THIS file only.
 */

import { GoldenLayout } from 'golden-layout';
import type { ComponentContainer, ComponentItem, ComponentItemConfig, ContentItem, LayoutConfig, Stack } from 'golden-layout';
import 'golden-layout/dist/css/goldenlayout-base.css';
import 'golden-layout/dist/css/themes/goldenlayout-dark-theme.css';

import type { LayoutDef, PaneNode, PaneView } from '../core/template.js';
import type { TabVisual } from '../core/visuals.js';

// --- Interface Definitions ---

interface EwBridge {
  ready(): void;
  onBootstrap(cb: (data: BootstrapPayload) => void): void;
  onPanes(cb: (data: { panes: PaneView[] }) => void): void;
  onSelect(cb: (data: { name: string }) => void): void;
  sendEvent(evt: Record<string, unknown>): void;
}

interface BootstrapPayload {
  template: unknown;
  panes: PaneView[];
  layout: LayoutDef;
  window: { title?: string };
  /** Present only when the host asked for the footer; the line itself comes from `url`. */
  status?: { url: string; intervalMs?: number; label?: string } | null;
}

interface PaneState {
  name?: string;
  url?: string;
  visual?: TabVisual;
  closable?: boolean;
}

declare global {
  interface Window {
    ElectronWrapperBridge?: EwBridge;
  }
}

// --- Function Definitions ---

const bridge = window.ElectronWrapperBridge;
const VISUALS: readonly TabVisual[] = ['solid', 'highlighted', 'flashing'];

let layout: GoldenLayout | null = null;
const itemsByName = new Map<string, ComponentItem>();
const nameByContainer = new WeakMap<ComponentContainer, string>();
let suppressActive = false;

function waitingElement(): HTMLElement | null {
  return document.getElementById('ew-waiting');
}

function setWaiting(show: boolean): void {
  const el = waitingElement();
  if (el) el.classList.toggle('ew-hidden', !show);
}

function paneConfig(pane: PaneNode | PaneView): ComponentItemConfig {
  return {
    type: 'component',
    componentType: 'ew-tab',
    title: pane.title,
    id: `ewtab:${pane.name}`,
    isClosable: pane.closable,
    componentState: { name: pane.name, url: pane.url, visual: pane.visual, closable: pane.closable },
  };
}

function toGl2Config(def: LayoutDef): LayoutConfig {
  return {
    root: {
      type: def.root.type,
      content: def.root.content.map((stack) => ({
        type: 'stack' as const,
        id: stack.id,
        title: stack.title,
        content: stack.content.map((pane) => paneConfig(pane)),
      })),
    },
    settings: { reorderEnabled: true },
    header: { popout: false, maximise: false },
    dimensions: { borderWidth: 4 },
  };
}

function applyTabVisual(el: HTMLElement, visual: TabVisual | undefined): void {
  for (const v of VISUALS) el.classList.toggle(`ew-tab--${v}`, v === (visual ?? 'solid'));
}

function applyVisualToItem(item: ComponentItem, visual: TabVisual): void {
  try {
    const tabEl = item.container.tab?.element;
    if (tabEl) applyTabVisual(tabEl, visual);
    const paneEl = item.container.element.querySelector('.ew-pane');
    if (paneEl) applyTabVisual(paneEl as HTMLElement, visual);
  } catch {
    /* the item may be mid-destroy — visuals are best-effort */
  }
}

function nameOfContainer(container: ComponentContainer): string | null {
  const mapped = nameByContainer.get(container);
  if (mapped) return mapped;
  const state = (container.initialState ?? {}) as PaneState;
  return typeof state.name === 'string' ? state.name : null;
}

/** The component factory: a tab IS a div + an iframe to its registered address. */
function makeComponent(container: ComponentContainer): void {
  const state = (container.initialState ?? {}) as PaneState;
  const name = typeof state.name === 'string' ? state.name : `unnamed-${Math.random().toString(36).slice(2, 6)}`;
  nameByContainer.set(container, name);

  const pane = document.createElement('div');
  pane.className = 'ew-pane';
  const frame = document.createElement('iframe');
  frame.setAttribute('data-ew-name', name);
  frame.setAttribute('title', name);
  if (typeof state.url === 'string') frame.src = state.url;
  pane.appendChild(frame);
  container.element.appendChild(pane);

  const paint = (): void => {
    const tab = container.tab;
    if (tab?.element) {
      tab.element.classList.add('ew-tab');
      applyTabVisual(tab.element, state.visual);
    }
    applyTabVisual(pane, state.visual);
  };
  paint();
  container.on('open', paint);

  // A closed tab is gone — the main process hears it and pops the registration.
  container.on('close', () => {
    bridge?.sendEvent({ kind: 'tab-close', name });
  });
}

/** Walk the tree to the stack named by a spot; fall back to the first stack. */
function findStackForSpot(spotId: string): Stack | null {
  const root = layout?.rootItem;
  if (!root) return null;
  let firstStack: Stack | null = null;
  const walk = (item: ContentItem): Stack | null => {
    if (item.isStack) {
      const s = item as Stack;
      if (!firstStack) firstStack = s;
      if (item.id === spotId) return s;
    }
    for (const child of item.contentItems) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(root) ?? firstStack;
}

function programmaticFocus(item: ComponentItem): void {
  suppressActive = true;
  try {
    layout?.focusComponent(item, true);
    item.parentItem.setActiveComponentItem(item, true, true);
  } catch {
    /* mid-destroy — never let a focus request throw */
  }
  setTimeout(() => {
    suppressActive = false;
  }, 0);
}

/** Diff the pane list against the layout: add, pop, repaint — never rebuild blind. */
function updatePanes(panes: PaneView[]): void {
  if (!layout) return;
  const seen = new Set<string>();

  for (const pane of panes) {
    seen.add(pane.name);
    const existing = itemsByName.get(pane.name);
    if (existing) {
      if (existing.isInitialised) {
        try {
          existing.setTitle(pane.title);
        } catch {
          /* title is not worth a throw */
        }
        applyVisualToItem(existing, pane.visual);
      }
      continue;
    }

    let item: ComponentItem | null = null;
    try {
      const stack = findStackForSpot(pane.spot);
      if (stack) {
        const added = stack.addItem(paneConfig(pane)) as unknown as ComponentItem | undefined;
        item = added ?? layout.findFirstComponentItemById(`ewtab:${pane.name}`) ?? null;
      } else {
        item = layout.newComponent('ew-tab', paneConfig(pane).componentState, pane.title);
      }
    } catch (err) {
      console.warn('[Electron_Wrapper] could not add pane', pane.name, err);
    }
    if (item) {
      itemsByName.set(pane.name, item);
      applyVisualToItem(item, pane.visual);
    }
  }

  for (const [name, item] of [...itemsByName]) {
    if (!seen.has(name)) {
      try {
        if (item.isInitialised) item.remove();
      } catch {
        /* already gone — the maps catch up via itemDestroyed */
      }
      itemsByName.delete(name);
    }
  }

  setWaiting(panes.length === 0);
}

function onBootstrap(data: BootstrapPayload): void {
  const rootEl = document.getElementById('ew-root');
  if (!rootEl || layout) return;
  if (data.window?.title) document.title = data.window.title;
  if (data.status?.url) startFooter(data.status);

  layout = new GoldenLayout(rootEl);
  layout.resizeWithContainerAutomatically = true;
  layout.registerComponentFactoryFunction('ew-tab', (container) => {
    makeComponent(container);
    return undefined;
  });

  layout.on('activeContentItemChanged', (item) => {
    if (suppressActive) return;
    const name = nameOfContainer(item.container);
    if (name) bridge?.sendEvent({ kind: 'tab-click', name });
  });

  layout.on('itemDestroyed', (evt) => {
    const target = evt.target as unknown as { container?: ComponentContainer };
    const container = target?.container;
    if (!container) return;
    const name = nameOfContainer(container);
    if (name) {
      itemsByName.delete(name);
      // GL2's close button removes the item; container 'close' only fires for
      // programmatic closes. So "a tab is gone" is heard here - the main process
      // pops the registration and lets the event out (echoes die there).
      bridge?.sendEvent({ kind: 'tab-close', name });
    }
  });

  // The layout's own config already CARRIES the panes (one component per tab), so the
  // first updatePanes must find them, not add them again. Register the loaded items
  // by name first; boot-time activation churn stays OUT of the event stream.
  suppressActive = true;
  try {
    layout.loadLayout(toGl2Config(data.layout));
    for (const pane of data.panes) {
      const item = layout.findFirstComponentItemById(`ewtab:${pane.name}`);
      if (item) itemsByName.set(pane.name, item);
    }
    updatePanes(data.panes);
  } finally {
    setTimeout(() => {
      suppressActive = false;
    }, 0);
  }
}

/**
 * The footer: one line, polled. It never blocks the layout, never throws into it, and says so plainly when the
 * source is down - a footer that silently keeps the last line is worse than one that admits it lost the plot.
 */
function startFooter(cfg: { url: string; intervalMs?: number; label?: string }): void {
  const el = document.getElementById('ew-footer');
  if (!el) return;
  const label = cfg.label ? `${cfg.label}  ` : '';
  const draw = (text: string, bad = false): void => {
    el.textContent = label + text;
    el.className = bad ? 'ew-footer-bad' : '';
    document.body.classList.add('ew-has-footer');
  };
  const tick = async (): Promise<void> => {
    try {
      const res = await fetch(cfg.url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { line?: unknown };
      draw(String(body.line ?? 'no line in the answer'));
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      draw(`status unavailable (${why}) — ${cfg.url}`, true);
    }
  };
  void tick();
  window.setInterval(() => {
    void tick();
  }, Math.max(500, cfg.intervalMs ?? 2000));
}

function boot(): void {
  if (!bridge) {
    const el = waitingElement();
    if (el) el.textContent = 'Electron_Wrapper — opened outside its host (no bridge).';
    return;
  }
  bridge.onBootstrap(onBootstrap);
  bridge.onPanes((data) => updatePanes(data.panes));
  bridge.onSelect((data) => {
    const item = itemsByName.get(data.name);
    if (item) programmaticFocus(item);
  });
  bridge.ready();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
