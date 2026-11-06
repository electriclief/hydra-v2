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
    list(): {
        tabs: TabEntry[];
        menus: MenuEntry[];
    };
    getTab(name: string): TabEntry | undefined;
    getMenu(id: string): MenuEntry | undefined;
    subscribe(fn: (change: RegistryChange) => void): () => void;
    size(): number;
}
export declare function canonicalEntry(raw: unknown): WrapperEntry;
export declare function createWrapperRegistry(): WrapperRegistry;
export declare function runTests(): Promise<void>;
