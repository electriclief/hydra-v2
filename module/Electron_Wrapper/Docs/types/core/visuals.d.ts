/**
 * @module visuals
 * @description A tab's presentation state, mirrored from the State module: SOLID (the
 *              silent default) · HIGHLIGHTED (wants a look) · FLASHING (expecting
 *              input). `normalizeVisual` reads whatever shape the state entry took;
 *              `autoSelect` answers the operator's rule — if only ONE tab is flashing,
 *              that tab auto-selects.
 * @intent The wrapper only reflects: owners change their own state; viewing clears
 *         nothing. The wrapper pulls, matches state logic, and shows.
 */
export type TabVisual = 'solid' | 'highlighted' | 'flashing';
export interface TabVisualEntry {
    name: string;
    visual: TabVisual;
}
/**
 * Tolerant read — the registrant's state entry may be a plain string ("flashing"),
 * or an object: {state|visual|status: '…'} · {flashing: true} · {highlighted: true} ·
 * {input: true} (expecting input → flashing). Anything unknown reads as solid.
 */
export declare function normalizeVisual(value: unknown): TabVisual;
/** The CSS class a visual rides with (applied alongside the pane's own classes). */
export declare function visualClass(visual: TabVisual): string;
/**
 * The operator's rule: if only one tab is flashing it auto-selects; zero or several
 * flashing tabs decide nothing (the wrapper never guesses).
 */
export declare function autoSelect(entries: TabVisualEntry[]): string | null;
/** Apply a raw state snapshot ({name: value}) onto a tab-name list. */
export declare function applySnapshot(names: string[], snapshot: Record<string, unknown>): TabVisualEntry[];
export declare function runTests(): Promise<void>;
