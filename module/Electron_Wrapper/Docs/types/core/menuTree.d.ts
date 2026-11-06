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
/** The application menu bar: one top-level item per registered menu. */
export declare function toBarTemplate(menus: MenuEntry[], dispatch: MenuDispatcher): NativeMenuItem[];
/** The tray's own tree: top-level items exactly as the tray menu was handed in. */
export declare function toTreeTemplate(context: MenuContext, items: MenuItemDef[], dispatch: MenuDispatcher): NativeMenuItem[];
export declare function runTests(): Promise<void>;
