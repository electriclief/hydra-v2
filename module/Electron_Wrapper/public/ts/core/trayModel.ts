/**
 * @module trayModel
 * @description The app tray, resolved as pure data. The wrapper SHIPS WITH a tray —
 *              default ON (`enabled: false` turns it off) — fed by input: an icon, a
 *              tooltip, and a menu tree with matching onclick hands. No menu tree
 *              handed in? The tray gets a minimal one (Show · Quit) built from the
 *              actions the host wired.
 * @intent "It needs one as part of Electron_wrapper — to come with it." The Go
 *         guardian tray belongs to the station warden; THIS tray belongs to the app.
 */

import type { MenuItemDef } from './registry.js';

// --- Interface Definitions ---

export interface TrayOptions {
  /** Default ON — only an explicit `false` turns the tray off. */
  enabled?: boolean;
  /** A path to a PNG/ICO, or a data URL. Absent → the module's own default icon. */
  icon?: string;
  tooltip?: string;
  /** The tray's menu tree — each item carries its own onClick. */
  menu?: MenuItemDef[];
}

export interface TrayActions {
  show: () => void;
  quit: () => void;
}

export interface TraySpec {
  enabled: boolean;
  icon: string | null;
  tooltip: string;
  menu: MenuItemDef[];
}

// --- Function Definitions ---

export function defaultTrayMenu(actions: TrayActions): MenuItemDef[] {
  return [
    { label: 'Show', onClick: actions.show },
    { type: 'separator' },
    { label: 'Quit', onClick: actions.quit },
  ];
}

export function resolveTraySpec(
  tray: TrayOptions | undefined,
  actions: TrayActions,
  defaultTooltip = 'Electron_Wrapper',
): TraySpec {
  const enabled = tray?.enabled !== false; // default ON
  const menu = tray?.menu && tray.menu.length > 0 ? tray.menu : defaultTrayMenu(actions);
  return {
    enabled,
    icon: typeof tray?.icon === 'string' && tray.icon.trim() !== '' ? tray.icon.trim() : null,
    tooltip: typeof tray?.tooltip === 'string' && tray.tooltip.trim() !== '' ? tray.tooltip : defaultTooltip,
    menu,
  };
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const ok = (label: string, cond: boolean, extra = ''): void => {
    console.assert(cond, `FAIL trayModel :: ${label}${extra ? ' :: ' + extra : ''}`);
  };

  let shown = 0;
  let quit = 0;
  const actions: TrayActions = { show: () => (shown += 1), quit: () => (quit += 1) };

  const bare = resolveTraySpec(undefined, actions);
  ok('the tray is default ON', bare.enabled === true);
  ok('no icon given — the module default rides later', bare.icon === null);
  ok('a default tooltip is provided', bare.tooltip === 'Electron_Wrapper');
  ok('the default menu is Show · Quit', bare.menu.length === 3 && bare.menu[0].label === 'Show' && bare.menu[2].label === 'Quit' && bare.menu[1].type === 'separator');
  bare.menu[0].onClick?.();
  bare.menu[2].onClick?.();
  ok('the default menu hands are wired to the host actions', shown === 1 && quit === 1);

  const off = resolveTraySpec({ enabled: false }, actions);
  ok('an explicit false turns the tray off', off.enabled === false);

  const given = resolveTraySpec(
    { icon: 'C:/x/i.png', tooltip: 'T', menu: [{ label: 'Only', onClick: () => undefined }] },
    actions,
  );
  ok('a given icon is kept', given.icon === 'C:/x/i.png');
  ok('a given tooltip is kept', given.tooltip === 'T');
  ok('a given menu wins over the default', given.menu.length === 1 && given.menu[0].label === 'Only');
  ok('an empty menu array falls back to the default', resolveTraySpec({ menu: [] }, actions).menu.length === 3);
  ok('a blank icon falls back to null', resolveTraySpec({ icon: '   ' }, actions).icon === null);
}
