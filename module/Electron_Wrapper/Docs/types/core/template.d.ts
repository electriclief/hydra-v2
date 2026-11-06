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
export declare const DEFAULT_TEMPLATE: TemplateDef;
export declare function normalizeTemplate(raw: unknown): TemplateDef;
/** Where a tab lands: its own spot when it named one that exists, else the default. */
export declare function spotFor(template: TemplateDef, tab: TabEntry): string;
/** Compose the neutral arrangement: one stack per spot (template order), panes inside. */
export declare function buildLayout(template: TemplateDef, panes: PaneView[]): LayoutDef;
export declare function runTests(): Promise<void>;
