/**
 * @module menuTree
 * @description Menu trees → native menu template, as pure DATA. One shape serves both
 *              surfaces: the application menu bar builds from registered menu entries,
 *              the tray builds from its own tree. Every click does two things: the
 *              registrant's own hand (onClick) runs, and the click goes OUT as an event
 *              through the dispatcher — so "any menu click can be registered".
 * @intent The wrapper holds the pen, the registrant holds the logic. A throwing hand is
 *         isolated: the event still goes out, the wrapper stays up.
 */

import type { MenuEntry, MenuItemDef } from './registry.js';

// --- Interface Definitions ---

export type MenuContext = 'menubar' | 'tray';

export interface MenuClickEvent {
  kind: 'menu-click';
  context: MenuContext;
  id: string;
  trail: string[];
}

export interface NativeMenuItem {
  label?: string;
  type?: 'normal' | 'separator';
  enabled?: boolean;
  checked?: boolean;
  submenu?: NativeMenuItem[];
  click?: () => void;
}

export type MenuDispatcher = (event: MenuClickEvent) => void;

// --- Function Definitions ---

function itemTrail(trail: string[], item: MenuItemDef): string[] {
  return [...trail, item.id ?? item.label ?? '?'];
}

function toNativeItem(context: MenuContext, item: MenuItemDef, trail: string[], dispatch: MenuDispatcher): NativeMenuItem {
  if (item.type === 'separator') return { type: 'separator' };
  const here = itemTrail(trail, item);
  const out: NativeMenuItem = { label: item.label };
  if (item.enabled !== undefined) out.enabled = item.enabled;
  if (item.checked !== undefined) out.checked = item.checked;
  if (item.submenu !== undefined) {
    out.submenu = item.submenu.map((child) => toNativeItem(context, child, here, dispatch));
  } else {
    out.click = () => {
      if (typeof item.onClick === 'function') {
        try {
          item.onClick();
        } catch (err) {
          console.warn('[Electron_Wrapper] a menu hand threw (isolated):', err);
        }
      }
      dispatch({ kind: 'menu-click', context, id: item.id ?? item.label ?? '?', trail: here });
    };
  }
  return out;
}

/** The application menu bar: one top-level item per registered menu. */
export function toBarTemplate(menus: MenuEntry[], dispatch: MenuDispatcher): NativeMenuItem[] {
  return menus.map((menu) => ({
    label: menu.label,
    submenu: menu.items.map((it) => toNativeItem('menubar', it, [menu.label], dispatch)),
  }));
}

/** The tray's own tree: top-level items exactly as the tray menu was handed in. */
export function toTreeTemplate(context: MenuContext, items: MenuItemDef[], dispatch: MenuDispatcher): NativeMenuItem[] {
  return items.map((it) => toNativeItem(context, it, [], dispatch));
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const ok = (label: string, cond: boolean, extra = ''): void => {
    console.assert(cond, `FAIL menuTree :: ${label}${extra ? ' :: ' + extra : ''}`);
  };

  const heard: MenuClickEvent[] = [];
  const dispatch: MenuDispatcher = (e) => heard.push(e);
  let hand = 0;

  const menus: MenuEntry[] = [
    {
      type: 'menu',
      id: 'file',
      label: 'File',
      items: [
        { label: 'Load', id: 'load', onClick: () => (hand += 1) },
        { type: 'separator' },
        {
          label: 'More',
          submenu: [{ label: 'Deep', id: 'deep', onClick: () => (hand += 100) }],
        },
      ],
    },
  ];

  const bar = toBarTemplate(menus, dispatch);
  ok('one top-level item per menu', bar.length === 1 && bar[0].label === 'File');
  const items = bar[0].submenu ?? [];
  ok('items map in order', items[0].label === 'Load' && items[1].type === 'separator' && items[2].label === 'More');
  ok('a submenu item carries a submenu', (items[2].submenu ?? []).length === 1);

  items[0].click?.();
  ok('a click runs the registrant hand', hand === 1);
  ok('and the click goes out as an event', heard.length === 1 && heard[0].kind === 'menu-click');
  ok('the event says menubar', heard[0].context === 'menubar' && heard[0].id === 'load');
  ok('the trail names the way in', heard[0].trail.join(' > ') === 'File > load');

  (items[2].submenu ?? [])[0].click?.();
  ok('a nested click runs its own hand', hand === 101);
  ok('a nested click carries its full trail', heard[1].trail.join(' > ') === 'File > More > deep');

  const tree = toTreeTemplate('tray', [{ label: 'Show', onClick: () => (hand += 1000) }, { type: 'separator' }, { label: 'Quit' }], dispatch);
  tree[0].click?.();
  ok('a tray click runs its hand', hand === 1101);
  ok('a tray click says tray', heard.at(-1)?.context === 'tray');

  // A throwing hand must not take the wrapper down — and the event still goes out.
  const before = heard.length;
  const poison = toBarTemplate(
    [{ type: 'menu', id: 'poison', label: 'Poison', items: [{ label: 'Boom', onClick: () => { throw new Error('hand exploded'); } }] }],
    dispatch,
  );
  poison[0].submenu?.[0].click?.();
  ok('a throwing hand is isolated and the event still goes out', heard.length === before + 1);
}
