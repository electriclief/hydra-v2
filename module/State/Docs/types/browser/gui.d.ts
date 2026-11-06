/**
 * @module gui (browser)
 * @description The page: the active set (walk it, pull from it), a pull bench (name +
 *              marks → the answer), and a live toggle (the change feed refreshes the
 *              list at the VIEWER'S own cadence — State controls no clocks). Pure
 *              renderers (self-checked by the gate) + mount() for the DOM wiring.
 * @intent The page imports the SAME client the tests use. A page that imports a module
 *         and gets a dead UI is the classic failure — the gate proves every id it wires
 *         exists in the real index.html, and that a page missing one fails loudly.
 */
import type { PullAnswer, StateEntryInfo } from '../stateRegistry.js';
/** Every element id the page wires — the gate cross-checks this list against index.html. */
export declare const GUI_IDS: string[];
export interface GuiHandle {
    stop(): void;
}
export declare function escapeHtml(value: unknown): string;
/** One held-state row: the path, when it landed, what it declares, one pull button. */
export declare function renderEntryRow(info: StateEntryInfo): string;
/** The answer, the way the reply reads: FULL or DELTA, the content, the fresh marks. */
export declare function renderReply(answer: PullAnswer): string;
export declare function renderStatus(health: unknown): string;
/** Wire the page. Returns null when a needed element is missing (fail loudly, never half-work). */
export declare function mount(doc?: Document): GuiHandle | null;
export declare function runTests(): Promise<void>;
