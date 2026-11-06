/**
 * @module gui
 * @description The human face of the wrapper: a page served from the API root that starts
 *              processes, shows the live table, follows a stream and kills.
 * @intent The API and the MCP endpoint are for machines; an operator needs one screen: type a
 *         command, watch it talk, stop it. This module is that screen — and it is deliberately
 *         split in two: the pure half (formatting and markup, no DOM) which the gate can
 *         self-check, and `mount()` which does the wiring against real elements. It talks to
 *         the SAME client module the CLI uses, so the page can never drift from the API.
 *
 * Loaded natively as an ES module (`<script type="module" src="/js/browser/gui.js">`) — no
 * bundler, because the browser resolves the same relative imports Node does.
 */
import { type StreamEvent } from '../client.js';
import type { ProcessRecord, ProcessLife, StreamChannel } from '../processWrapper.js';
import type { CommandDefinition } from '../registryStore.js';
/** Everything the page needs to know about one render pass. */
export interface GuiState {
    processes: ProcessRecord[];
    selectedId: string | null;
    following: boolean;
    saved: CommandDefinition[];
    savedName: string | null;
    channel: StreamChannel | 'both';
    health: Record<string, unknown> | null;
    error: string | null;
    now: number;
}
/** The handle `mount()` returns, so a test (or the console) can drive the page. */
export interface GuiHandle {
    refresh(): Promise<void>;
    select(id: string | null): void;
    setFollowing(on: boolean): void;
    stop(): void;
    state(): GuiState;
}
/** Escape text for HTML. Every value that reaches the DOM goes through here. */
export declare function escapeHtml(value: unknown): string;
/** The CSS class for a life, so the table colours itself. */
export declare function lifeClass(life: ProcessLife): string;
/** Characters, in a size an eye can read at a glance. */
export declare function formatChars(n: number): string;
/** How long a life has been (or was) going. */
export declare function formatUptime(rec: ProcessRecord, now?: number): string;
/** One row of the process table. Pure: state in, markup out. */
export declare function renderProcessRow(rec: ProcessRecord, opts?: {
    selected?: boolean;
    now?: number;
}): string;
/** The process table body, or a friendly empty line. */
export declare function renderProcessTable(list: ProcessRecord[], opts?: {
    selectedId?: string | null;
    now?: number;
}): string;
/** One saved command, with its launch and delete affordances. */
export declare function renderCommandRow(def: CommandDefinition): string;
/** The saved-command picker's options. */
export declare function renderSavedOptions(list: CommandDefinition[], selected: string | null): string;
/** The health badge text. */
export declare function renderHealthBadge(health: Record<string, unknown> | null): string;
/** The stream chapter heading for one process. */
export declare function renderStreamHeader(rec: ProcessRecord | null): string;
/** A follow note — what the live copy is doing. */
export declare function followNotice(ev: StreamEvent): string;
/** Parse the env box: JSON object, or one KEY=VALUE per line, or empty. Throws on junk. */
export declare function parseEnvInput(raw: string): Record<string, string> | undefined;
/** Wire the page to a running wrapper. Does nothing when there is no DOM (the gate). */
export declare function mount(doc?: Document | undefined): GuiHandle | null;
export declare function runTests(): Promise<void>;
