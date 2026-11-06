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
import 'golden-layout/dist/css/goldenlayout-base.css';
import 'golden-layout/dist/css/themes/goldenlayout-dark-theme.css';
import type { LayoutDef, PaneView } from '../core/template.js';
interface EwBridge {
    ready(): void;
    onBootstrap(cb: (data: BootstrapPayload) => void): void;
    onPanes(cb: (data: {
        panes: PaneView[];
    }) => void): void;
    onSelect(cb: (data: {
        name: string;
    }) => void): void;
    sendEvent(evt: Record<string, unknown>): void;
}
interface BootstrapPayload {
    template: unknown;
    panes: PaneView[];
    layout: LayoutDef;
    window: {
        title?: string;
    };
}
declare global {
    interface Window {
        ElectronWrapperBridge?: EwBridge;
    }
}
export {};
