function normalizeSink(sink) {
  if (!sink) return null;
  if (typeof sink === "function") return sink;
  if (typeof sink === "object" && typeof sink.trigger === "function") {
    const holder = sink;
    return (name, payload) => {
      holder.trigger(name, payload);
    };
  }
  return null;
}
function dispatch(sink, event) {
  if (!sink) return false;
  try {
    sink(event.kind, event);
    return true;
  } catch (err) {
    console.warn("[Electron_Wrapper] the event sink threw (isolated):", err);
    return false;
  }
}
async function runTests() {
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL events :: ${label}${extra ? " :: " + extra : ""}`);
  };
  ok("no sink normalizes to null", normalizeSink(void 0) === null);
  ok("a non-callable normalizes to null", normalizeSink(42) === null);
  const seen = [];
  const asFn = normalizeSink((name, payload) => seen.push({ name, payload }));
  ok("a plain function is a sink", typeof asFn === "function");
  const asInstance = normalizeSink({ trigger: (name, payload) => seen.push({ name, payload }) });
  ok("an instance with .trigger is a sink", typeof asInstance === "function");
  ok("dispatch with no sink is a quiet false", dispatch(null, { kind: "x" }) === false);
  let heard = null;
  const recorder = normalizeSink((_n, p) => heard = p);
  ok("dispatch with a sink lands", dispatch(recorder, { kind: "tab-click", name: "A" }) === true);
  ok("the payload arrives whole", heard !== null && heard.kind === "tab-click" && heard.name === "A");
  const thrower = normalizeSink(() => {
    throw new Error("sink exploded");
  });
  ok("a throwing sink is isolated, not fatal", dispatch(thrower, { kind: "y" }) === false);
  asFn?.("via-fn", { n: 1 });
  asInstance?.("via-instance", { n: 2 });
  ok("both sink shapes reach the same hand", seen.length === 2 && seen[0].name === "via-fn" && seen[1].name === "via-instance");
}
export {
  dispatch,
  normalizeSink,
  runTests
};
//# sourceMappingURL=events.js.map
