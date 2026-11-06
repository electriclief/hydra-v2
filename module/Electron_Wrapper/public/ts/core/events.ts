/**
 * @module events
 * @description Every happening goes OUT through one hand: the event-handler instance.
 *              `normalizeSink` accepts whatever the host wired — an instance with
 *              `.trigger(name, payload)` (the Event_Handler shape) or a plain function —
 *              and a missing sink is fine: the wrapper still works, the events are
 *              simply unheard. `dispatch` never lets a listener take the wrapper down.
 * @intent "Just send the event" — the magic after that is not this module's problem.
 */

// --- Interface Definitions ---

export type EventSink = (name: string, payload: unknown) => void;

export interface WrapperEvent {
  kind: string;
  [key: string]: unknown;
}

// --- Function Definitions ---

export function normalizeSink(sink: unknown): EventSink | null {
  if (!sink) return null;
  if (typeof sink === 'function') return sink as EventSink;
  if (
    typeof sink === 'object' &&
    typeof (sink as { trigger?: unknown }).trigger === 'function'
  ) {
    const holder = sink as { trigger: (name: string, payload?: unknown) => unknown };
    return (name, payload) => {
      holder.trigger(name, payload);
    };
  }
  return null;
}

/** Send one event. Returns whether a sink actually heard it. Isolated, always. */
export function dispatch(sink: EventSink | null, event: WrapperEvent): boolean {
  if (!sink) return false;
  try {
    sink(event.kind, event);
    return true;
  } catch (err) {
    console.warn('[Electron_Wrapper] the event sink threw (isolated):', err);
    return false;
  }
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const ok = (label: string, cond: boolean, extra = ''): void => {
    console.assert(cond, `FAIL events :: ${label}${extra ? ' :: ' + extra : ''}`);
  };

  ok('no sink normalizes to null', normalizeSink(undefined) === null);
  ok('a non-callable normalizes to null', normalizeSink(42) === null);

  const seen: Array<{ name: string; payload: unknown }> = [];
  const asFn = normalizeSink((name: string, payload: unknown) => seen.push({ name, payload }));
  ok('a plain function is a sink', typeof asFn === 'function');

  // The Event_Handler shape: an instance with .trigger(name, payload).
  const asInstance = normalizeSink({ trigger: (name: string, payload: unknown) => seen.push({ name, payload }) });
  ok('an instance with .trigger is a sink', typeof asInstance === 'function');

  ok('dispatch with no sink is a quiet false', dispatch(null, { kind: 'x' }) === false);

  let heard: WrapperEvent | null = null;
  const recorder = normalizeSink((_n: string, p: unknown) => (heard = p as WrapperEvent));
  ok('dispatch with a sink lands', dispatch(recorder, { kind: 'tab-click', name: 'A' }) === true);
  ok('the payload arrives whole', heard !== null && (heard as WrapperEvent).kind === 'tab-click' && (heard as WrapperEvent).name === 'A');

  const thrower = normalizeSink(() => {
    throw new Error('sink exploded');
  });
  ok('a throwing sink is isolated, not fatal', dispatch(thrower, { kind: 'y' }) === false);

  asFn?.('via-fn', { n: 1 });
  asInstance?.('via-instance', { n: 2 });
  ok('both sink shapes reach the same hand', seen.length === 2 && seen[0].name === 'via-fn' && seen[1].name === 'via-instance');
}

// The event shapes the wrapper sends, in one place so nothing drifts:
//   {kind:'tab-click',  name}                 — a tab's header was clicked
//   {kind:'tab-close',  name}                 — a tab was closed (and popped)
//   {kind:'menu-click', context:'menubar', id, trail}   — an application menu item
//   {kind:'menu-click', context:'tray',    id, trail}   — a tray menu item
//   {kind:'app-closed'}                       — the app is really closing now
