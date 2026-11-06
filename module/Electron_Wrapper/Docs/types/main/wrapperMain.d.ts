/**
 * @module wrapperMain
 * @description The wrapper's main-process machine. Given an injected electron surface
 *              (or lazily importing electron inside a real app), `createWrapperModule`
 *              stands the whole thing up: the window with the wrapper page, the template
 *              + registered tabs (name + path → a div/iframe), the application menu
 *              bar built from registered menus, the app tray (default ON; icon as input),
 *              the event path OUT through the event-handler instance ("app closed"
 *              included), and the optional per-tab state pull (solid · highlighted ·
 *              flashing; a lone flashing tab auto-selects). Boots blank; decides nothing.
 * @intent The dumb terminal: throw 4 addresses + a template together and have an app
 *         with 4 tabs. The compiled binary never learns what a tab renders.
 *
 * NOTE (Electron ESM entries): with an ESM main-process entry file, Electron fires
 * 'ready' only after the entry module finishes evaluating. Never top-level-await
 * createModule(...) inside such an entry — a TLA that reaches app.whenReady()
 * deadlocks silently. Schedule with app.whenReady().then(...) instead.
 */
import { type EntryKind, type TabEntry, type WrapperEntry, type WrapperRegistry } from '../core/registry.js';
import { type PaneView, type TemplateDef } from '../core/template.js';
import { type TrayOptions } from '../core/trayModel.js';
/** The little piece of electron the wrapper actually touches — structural, injectable. */
export interface ElectronSurface {
    app: {
        whenReady(): Promise<void>;
        on(event: string, cb: (...args: unknown[]) => void): void;
        quit(): void;
    };
    BrowserWindow: new (opts: Record<string, unknown>) => EwBrowserWindow;
    Menu: {
        setApplicationMenu(menu: unknown): void;
        buildFromTemplate(template: unknown[]): unknown;
    };
    Tray: new (image: unknown) => EwTray;
    nativeImage: {
        createFromPath(p: string): unknown;
        createFromDataURL(d: string): unknown;
    };
    ipcMain: {
        on(channel: string, cb: (...args: unknown[]) => void): void;
        removeListener(channel: string, cb: (...args: unknown[]) => void): void;
    };
}
export interface EwBrowserWindow {
    loadFile(file: string): Promise<void>;
    webContents: {
        send(channel: string, ...args: unknown[]): void;
    };
    on(event: string, cb: (...args: unknown[]) => void): void;
    show(): void;
    hide(): void;
    isVisible(): boolean;
    isDestroyed(): boolean;
    focus(): void;
}
export interface EwTray {
    setToolTip(tooltip: string): void;
    setContextMenu(menu: unknown): void;
    on(event: string, cb: (...args: unknown[]) => void): void;
    destroy(): void;
}
export interface WrapperWindowOptions {
    title?: string;
    width?: number;
    height?: number;
    /** Path to a window/taskbar icon. */
    icon?: string;
    /** Start visible; default true. */
    show?: boolean;
    /** true → closing the window really closes the app (default: hide-to-tray when the tray is on). */
    quitOnClose?: boolean;
}
export interface WrapperStateOptions {
    /** The state door, e.g. "http://127.0.0.1:8127". */
    endpoint: string;
    intervalMs?: number;
}
export interface CreateWrapperOptions {
    /** Injected electron surface; when absent, the module imports electron itself (running inside an app). */
    electron?: ElectronSurface;
    /** The template (spots for tab insertions); absent → the default single spot. */
    template?: unknown;
    /** Initial registrations — tabs ({type:'tab', name, path, spot?}) and menus; live register() is the normal life. */
    entries?: unknown[];
    /** The app tray: default ON; icon as input; a menu tree with matching onclick. */
    tray?: TrayOptions;
    window?: WrapperWindowOptions;
    /** The event-handler instance (anything with .trigger(name, payload), or a plain function). */
    eventHandler?: unknown;
    /** Optional: pull each tab's state from a State door. */
    state?: WrapperStateOptions;
}
export interface WrapperModule {
    registry: WrapperRegistry;
    template: TemplateDef;
    whenBooted: Promise<void>;
    register(entry: unknown): WrapperEntry;
    unregister(kind: EntryKind, key: string): boolean;
    list(): {
        tabs: TabEntry[];
        menus: WrapperEntry[];
    };
    panes(): PaneView[];
    show(): void;
    hide(): void;
    sendEvent(kind: string, detail?: Record<string, unknown>): boolean;
    quit(): void;
    stop(): Promise<void>;
}
export declare function createWrapperModule(options?: CreateWrapperOptions): Promise<WrapperModule>;
export declare function runTests(): Promise<void>;
