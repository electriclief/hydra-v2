function itemTrail(trail, item) {
  return [...trail, item.id ?? item.label ?? "?"];
}
function toNativeItem(context, item, trail, dispatch) {
  if (item.type === "separator") return { type: "separator" };
  const here = itemTrail(trail, item);
  const out = { label: item.label };
  if (item.enabled !== void 0) out.enabled = item.enabled;
  if (item.checked !== void 0) out.checked = item.checked;
  if (item.submenu !== void 0) {
    out.submenu = item.submenu.map((child) => toNativeItem(context, child, here, dispatch));
  } else {
    out.click = () => {
      if (typeof item.onClick === "function") {
        try {
          item.onClick();
        } catch (err) {
          console.warn("[Electron_Wrapper] a menu hand threw (isolated):", err);
        }
      }
      dispatch({ kind: "menu-click", context, id: item.id ?? item.label ?? "?", trail: here });
    };
  }
  return out;
}
function toBarTemplate(menus, dispatch) {
  return menus.map((menu) => ({
    label: menu.label,
    submenu: menu.items.map((it) => toNativeItem("menubar", it, [menu.label], dispatch))
  }));
}
function toTreeTemplate(context, items, dispatch) {
  return items.map((it) => toNativeItem(context, it, [], dispatch));
}
async function runTests() {
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL menuTree :: ${label}${extra ? " :: " + extra : ""}`);
  };
  const heard = [];
  const dispatch = (e) => heard.push(e);
  let hand = 0;
  const menus = [
    {
      type: "menu",
      id: "file",
      label: "File",
      items: [
        { label: "Load", id: "load", onClick: () => hand += 1 },
        { type: "separator" },
        {
          label: "More",
          submenu: [{ label: "Deep", id: "deep", onClick: () => hand += 100 }]
        }
      ]
    }
  ];
  const bar = toBarTemplate(menus, dispatch);
  ok("one top-level item per menu", bar.length === 1 && bar[0].label === "File");
  const items = bar[0].submenu ?? [];
  ok("items map in order", items[0].label === "Load" && items[1].type === "separator" && items[2].label === "More");
  ok("a submenu item carries a submenu", (items[2].submenu ?? []).length === 1);
  items[0].click?.();
  ok("a click runs the registrant hand", hand === 1);
  ok("and the click goes out as an event", heard.length === 1 && heard[0].kind === "menu-click");
  ok("the event says menubar", heard[0].context === "menubar" && heard[0].id === "load");
  ok("the trail names the way in", heard[0].trail.join(" > ") === "File > load");
  (items[2].submenu ?? [])[0].click?.();
  ok("a nested click runs its own hand", hand === 101);
  ok("a nested click carries its full trail", heard[1].trail.join(" > ") === "File > More > deep");
  const tree = toTreeTemplate("tray", [{ label: "Show", onClick: () => hand += 1e3 }, { type: "separator" }, { label: "Quit" }], dispatch);
  tree[0].click?.();
  ok("a tray click runs its hand", hand === 1101);
  ok("a tray click says tray", heard.at(-1)?.context === "tray");
  const before = heard.length;
  const poison = toBarTemplate(
    [{ type: "menu", id: "poison", label: "Poison", items: [{ label: "Boom", onClick: () => {
      throw new Error("hand exploded");
    } }] }],
    dispatch
  );
  poison[0].submenu?.[0].click?.();
  ok("a throwing hand is isolated and the event still goes out", heard.length === before + 1);
}
export {
  runTests,
  toBarTemplate,
  toTreeTemplate
};
//# sourceMappingURL=menuTree.js.map
