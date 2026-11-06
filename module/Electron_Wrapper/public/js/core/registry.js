function fail(what) {
  throw new Error(`registration refused: ${what}`);
}
function canonicalTab(raw) {
  if (typeof raw !== "object" || raw === null) fail("a tab must be an object");
  const t = raw;
  if (typeof t.name !== "string" || t.name.trim() === "") fail("a tab needs a name");
  if (typeof t.path !== "string" || t.path.trim() === "") fail(`tab "${t.name}" needs a path (the address its page answers at)`);
  const entry = { type: "tab", name: t.name.trim(), path: t.path.trim() };
  if (typeof t.spot === "string" && t.spot.trim() !== "") entry.spot = t.spot.trim();
  if (t.closable !== void 0) entry.closable = Boolean(t.closable);
  if (t.meta !== void 0) entry.meta = t.meta;
  return entry;
}
function canonicalItem(raw, trail) {
  if (typeof raw !== "object" || raw === null) fail(`menu item ${trail} must be an object`);
  const it = raw;
  if (it.type === "separator") return { type: "separator" };
  if (typeof it.label !== "string" || it.label.trim() === "") fail(`menu item ${trail} needs a label`);
  const out = { label: it.label };
  if (typeof it.id === "string") out.id = it.id;
  if (typeof it.onClick === "function") out.onClick = it.onClick;
  if (it.enabled !== void 0) out.enabled = Boolean(it.enabled);
  if (it.checked !== void 0) out.checked = Boolean(it.checked);
  if (it.submenu !== void 0) {
    if (!Array.isArray(it.submenu)) fail(`menu item ${trail} submenu must be an array`);
    out.submenu = it.submenu.map((child, i) => canonicalItem(child, `${trail} > ${i}`));
  }
  return out;
}
function canonicalMenu(raw) {
  if (typeof raw !== "object" || raw === null) fail("a menu must be an object");
  const m = raw;
  if (typeof m.id !== "string" || m.id.trim() === "") fail("a menu needs an id");
  if (typeof m.label !== "string" || m.label.trim() === "") fail(`menu "${m.id}" needs a label`);
  if (!Array.isArray(m.items)) fail(`menu "${m.id}" needs an items array`);
  return {
    type: "menu",
    id: m.id.trim(),
    label: m.label,
    items: m.items.map((it, i) => canonicalItem(it, `${m.id} > ${i}`))
  };
}
function canonicalEntry(raw) {
  if (typeof raw !== "object" || raw === null) fail("not an object");
  const type = raw.type;
  if (type === "tab") return canonicalTab(raw);
  if (type === "menu") return canonicalMenu(raw);
  fail(`unknown entry type "${String(type)}" (a tab or a menu)`);
}
function createWrapperRegistry() {
  const tabMap = /* @__PURE__ */ new Map();
  const menuMap = /* @__PURE__ */ new Map();
  const subscribers = /* @__PURE__ */ new Set();
  const notify = (change) => {
    for (const fn of [...subscribers]) {
      try {
        fn(change);
      } catch (err) {
        console.warn("[Electron_Wrapper] a registry subscriber threw (isolated):", err);
      }
    }
  };
  const compareTabs = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  return {
    register(raw) {
      const entry = canonicalEntry(raw);
      if (entry.type === "tab") {
        const prev2 = tabMap.get(entry.name);
        if (prev2 && compareTabs(prev2, entry)) return prev2;
        tabMap.set(entry.name, entry);
        notify({ kind: prev2 ? "update" : "register", entryKind: "tab", key: entry.name });
        return entry;
      }
      const prev = menuMap.get(entry.id);
      menuMap.set(entry.id, entry);
      notify({ kind: prev ? "update" : "register", entryKind: "menu", key: entry.id });
      return entry;
    },
    unregister(entryKind, key) {
      const found = entryKind === "tab" ? tabMap.delete(key) : menuMap.delete(key);
      if (found) notify({ kind: "unregister", entryKind, key });
      return found;
    },
    tabs() {
      return [...tabMap.values()];
    },
    menus() {
      return [...menuMap.values()];
    },
    list() {
      return { tabs: this.tabs(), menus: this.menus() };
    },
    getTab(name) {
      return tabMap.get(name);
    },
    getMenu(id) {
      return menuMap.get(id);
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    size() {
      return tabMap.size + menuMap.size;
    }
  };
}
async function runTests() {
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL registry :: ${label}${extra ? " :: " + extra : ""}`);
  };
  const throws = (label, fn) => {
    let threw = false;
    try {
      fn();
    } catch {
      threw = true;
    }
    ok(label, threw);
  };
  const r = createWrapperRegistry();
  ok("boots blank", r.size() === 0);
  const changes = [];
  const unsub = r.subscribe((c) => changes.push(`${c.kind}:${c.entryKind}:${c.key}`));
  const tab = r.register({ type: "tab", name: "Comfy A", path: "localhost:8188" });
  ok("a tab registers", tab.type === "tab" && tab.name === "Comfy A");
  ok("the change is heard", changes.at(-1) === "register:tab:Comfy A");
  r.register({ type: "tab", name: "Comfy A", path: "localhost:8188" });
  ok("an identical re-hand is a no-op", changes.length === 1);
  r.register({ type: "tab", name: "Comfy A", path: "localhost:8189" });
  ok("a changed re-hand is an update", changes.at(-1) === "update:tab:Comfy A");
  ok("the path was replaced", r.getTab("Comfy A")?.path === "localhost:8189");
  r.register({ type: "tab", name: "Comfy B", path: "192.168.1.50:8188", spot: "side" });
  ok("a second tab lands", r.tabs().length === 2);
  ok("spot rides along", r.getTab("Comfy B")?.spot === "side");
  const menu = r.register({ type: "menu", id: "file", label: "File", items: [{ label: "Load", onClick: () => void 0 }] });
  ok("a menu registers", menu.type === "menu" && r.getMenu("file")?.label === "File");
  ok("tabs and menus stay separate kinds", r.tabs().length === 2 && r.menus().length === 1);
  ok("unregister pops", r.unregister("tab", "Comfy B") === true && r.tabs().length === 1);
  ok("unregister of a ghost is false", r.unregister("tab", "Comfy B") === false);
  unsub();
  r.register({ type: "tab", name: "Quiet", path: "x:1" });
  ok("unsubscribed ears hear nothing more", !changes.some((c) => c.includes("Quiet")));
  throws("a tab without a name is refused", () => r.register({ type: "tab", path: "x" }));
  throws("a tab without a path is refused", () => r.register({ type: "tab", name: "x" }));
  throws("a menu without items is refused", () => r.register({ type: "menu", id: "m", label: "M" }));
  throws("an unknown type is refused", () => r.register({ type: "thing", name: "x" }));
  throws(
    "a labelled menu item without a label is refused",
    () => r.register({ type: "menu", id: "m", label: "M", items: [{ type: "normal" }] })
  );
  const sep = r.register({
    type: "menu",
    id: "m2",
    label: "M2",
    items: [{ type: "separator" }, { label: "A", submenu: [{ label: "B" }] }]
  });
  ok(
    "separators and submenus survive canonicalization",
    sep.type === "menu" && sep.items[0].type === "separator" && sep.items[1].submenu?.[0].label === "B"
  );
}
export {
  canonicalEntry,
  createWrapperRegistry,
  runTests
};
//# sourceMappingURL=registry.js.map
