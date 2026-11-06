/**
 * @module gui (browser)
 * @description The page: the palette (fire any registered event), the live log (SSE),
 *              filters, purge. Pure renderers (self-checked by the gate) + mount() for
 *              the DOM wiring.
 * @intent The page imports the SAME client the tests use. A page that imports a module
 *         and gets a dead UI is the classic failure — the gate proves every id it wires
 *         exists in the real index.html, and that a page missing one fails loudly.
 */
import type { RegisteredEvent } from '../eventHandler.js';
import type { LogLine } from '../logStore.js';
/** Every element id the page wires — the gate cross-checks this list against index.html. */
export declare const GUI_IDS: string[];
export interface GuiHandle {
    stop(): void;
}
export declare function escapeHtml(value: unknown): string;
/** One palette row: name, what it does, its fire count, one button. */
export declare function renderEventRow(ev: RegisteredEvent): string;
/** One log line, the way the record reads. */
export declare function renderLogLine(line: LogLine): string;
export declare function renderStatus(health: unknown): string;
/** Wire the page. Returns null when a needed element is missing (fail loudly, never half-work). */
export declare function mount(doc?: Document): GuiHandle | null;
export declare function runTests(): Promise<void>;
