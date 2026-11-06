/**
 * @module browser/window
 * @description The console window: one tab per console display, served from the door's
 *              own page. The add bar fires "add Process Console Display"; a tab's close
 *              button fires "kill Process Console Display" — nothing here reaches around
 *              the event door. Minimizing parks a display in the native Window menu (the
 *              electron host owns that menu; in a plain browser the tab simply leaves).
 * @intent Operator shape (2026-09-25): ProcessWrapper is launched once; consoles arrive
 *         as events; a display can leave the strip without the process ending. Every
 *         hand (this form, the API, a command-line arg, a script) fires the same event.
 */
/** One row of the door's process table, as this window reads it. */
export interface ConsoleRow {
    id: string;
    name: string;
    life: string;
}
/** What the window remembers about one console. */
export interface ConsoleState {
    id: string;
    name: string;
    life: string;
    /** Characters already pulled into this tab. */
    seen: number;
    minimized: boolean;
    closing: boolean;
}
export interface MergeResult {
    next: Map<string, ConsoleState>;
    added: string[];
    endedIds: string[];
}
/** Everything the window needs from its host (the electron shell supplies the IPC half). */
export interface ConsoleWindowEnv {
    fetchFn?: typeof fetch;
    doc?: Document;
    ipc?: {
        minimized(names: string[]): void;
        onRestore(handler: (name: string) => void): void;
    } | null;
    origin?: string;
}
export declare function isAlive(life: string): boolean;
/** Fold the door's table into the window's state: who appeared, who crossed to dead. */
export declare function mergeConsoles(list: ConsoleRow[], prior: Map<string, ConsoleState>): MergeResult;
export declare function tabLabel(state: ConsoleState): string;
export declare function visibleTabs(states: Map<string, ConsoleState>): ConsoleState[];
/** The door answers { processes, count }; accept the bare array too (tests, future hands). */
export declare function rowsOf(data: unknown): ConsoleRow[];
export declare function bootConsoleWindow(env?: ConsoleWindowEnv): void;
export declare function runTests(): Promise<void>;
