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
export declare function defaultTrayMenu(actions: TrayActions): MenuItemDef[];
export declare function resolveTraySpec(tray: TrayOptions | undefined, actions: TrayActions, defaultTooltip?: string): TraySpec;
export declare function runTests(): Promise<void>;
