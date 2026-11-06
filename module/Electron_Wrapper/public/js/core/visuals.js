function fromString(value) {
  const v = value.toLowerCase();
  if (v.includes("flash")) return "flashing";
  if (v.includes("high") || v.includes("activ") || v.includes("warn") || v.includes("wait")) return "highlighted";
  return "solid";
}
function normalizeVisual(value) {
  if (typeof value === "string") return fromString(value);
  if (typeof value === "object" && value !== null) {
    const o = value;
    if (o.flashing === true || o.expectingInput === true || o.input === true) return "flashing";
    if (o.highlighted === true || o.active === true) return "highlighted";
    for (const key of ["state", "visual", "status"]) {
      const inner = o[key];
      if (typeof inner === "string") return fromString(inner);
    }
    if (typeof o.value === "string") return fromString(o.value);
  }
  return "solid";
}
function visualClass(visual) {
  return `ew-tab--${visual}`;
}
function autoSelect(entries) {
  const flashing = entries.filter((e) => e.visual === "flashing");
  return flashing.length === 1 ? flashing[0].name : null;
}
function applySnapshot(names, snapshot) {
  return names.map((name) => ({ name, visual: normalizeVisual(snapshot[name]) }));
}
async function runTests() {
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL visuals :: ${label}${extra ? " :: " + extra : ""}`);
  };
  ok("a plain string reads", normalizeVisual("flashing") === "flashing");
  ok("case does not matter", normalizeVisual("Highlighted") === "highlighted");
  ok("solid reads solid", normalizeVisual("solid") === "solid");
  ok('"active" reads highlighted', normalizeVisual("active") === "highlighted");
  ok("a boolean shape reads flashing", normalizeVisual({ flashing: true }) === "flashing");
  ok("expecting input reads flashing", normalizeVisual({ input: true }) === "flashing");
  ok("a state field reads", normalizeVisual({ state: "flashing" }) === "flashing");
  ok("a visual field reads", normalizeVisual({ visual: "highlighted" }) === "highlighted");
  ok("a value field reads", normalizeVisual({ value: "flashing" }) === "flashing");
  ok("unknown reads solid", normalizeVisual({ junk: 1 }) === "solid");
  ok("undefined reads solid", normalizeVisual(void 0) === "solid");
  ok("null reads solid", normalizeVisual(null) === "solid");
  ok("the class follows the name", visualClass("flashing") === "ew-tab--flashing");
  ok("the class follows the name (highlighted)", visualClass("highlighted") === "ew-tab--highlighted");
  const lone = autoSelect([
    { name: "a", visual: "solid" },
    { name: "b", visual: "flashing" },
    { name: "c", visual: "highlighted" }
  ]);
  ok("a lone flashing tab auto-selects", lone === "b");
  ok(
    "several flashing tabs decide nothing",
    autoSelect([
      { name: "a", visual: "flashing" },
      { name: "b", visual: "flashing" }
    ]) === null
  );
  ok("zero flashing tabs decide nothing", autoSelect([{ name: "a", visual: "solid" }]) === null);
  const applied = applySnapshot(["a", "b"], { a: "flashing", b: { state: "highlighted" } });
  ok("a snapshot applies onto the names", applied[0].visual === "flashing" && applied[1].visual === "highlighted");
  ok("a name missing from the snapshot reads solid", applySnapshot(["x"], {})[0].visual === "solid");
}
export {
  applySnapshot,
  autoSelect,
  normalizeVisual,
  runTests,
  visualClass
};
//# sourceMappingURL=visuals.js.map
