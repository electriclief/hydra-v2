/**
 * @module events
 * @description Every happening goes OUT through one hand: the event-handler instance.
 *              `normalizeSink` accepts whatever the host wired — an instance with
 *              `.trigger(name, payload)` (the Event_Handler shape) or a plain function —
 *              and a missing sink is fine: the wrapper still works, the events are
 *              simply unheard. `dispatch` never lets a listener take the wrapper down.
 * @intent "Just send the event" — the magic after that is not this module's problem.
 */
export type EventSink = (name: string, payload: unknown) => void;
export interface WrapperEvent {
    kind: string;
    [key: string]: unknown;
}
export declare function normalizeSink(sink: unknown): EventSink | null;
/** Send one event. Returns whether a sink actually heard it. Isolated, always. */
export declare function dispatch(sink: EventSink | null, event: WrapperEvent): boolean;
export declare function runTests(): Promise<void>;
