function defaultTrayMenu(actions) {
  return [
    { label: "Show", onClick: actions.show },
    { type: "separator" },
    { label: "Quit", onClick: actions.quit }
  ];
}
function resolveTraySpec(tray, actions, defaultTooltip = "Electron_Wrapper") {
  const enabled = tray?.enabled !== false;
  const menu = tray?.menu && tray.menu.length > 0 ? tray.menu : defaultTrayMenu(actions);
  return {
    enabled,
    icon: typeof tray?.icon === "string" && tray.icon.trim() !== "" ? tray.icon.trim() : null,
    tooltip: typeof tray?.tooltip === "string" && tray.tooltip.trim() !== "" ? tray.tooltip : defaultTooltip,
    menu
  };
}
async function runTests() {
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL trayModel :: ${label}${extra ? " :: " + extra : ""}`);
  };
  let shown = 0;
  let quit = 0;
  const actions = { show: () => shown += 1, quit: () => quit += 1 };
  const bare = resolveTraySpec(void 0, actions);
  ok("the tray is default ON", bare.enabled === true);
  ok("no icon given \u2014 the module default rides later", bare.icon === null);
  ok("a default tooltip is provided", bare.tooltip === "Electron_Wrapper");
  ok("the default menu is Show \xB7 Quit", bare.menu.length === 3 && bare.menu[0].label === "Show" && bare.menu[2].label === "Quit" && bare.menu[1].type === "separator");
  bare.menu[0].onClick?.();
  bare.menu[2].onClick?.();
  ok("the default menu hands are wired to the host actions", shown === 1 && quit === 1);
  const off = resolveTraySpec({ enabled: false }, actions);
  ok("an explicit false turns the tray off", off.enabled === false);
  const given = resolveTraySpec(
    { icon: "C:/x/i.png", tooltip: "T", menu: [{ label: "Only", onClick: () => void 0 }] },
    actions
  );
  ok("a given icon is kept", given.icon === "C:/x/i.png");
  ok("a given tooltip is kept", given.tooltip === "T");
  ok("a given menu wins over the default", given.menu.length === 1 && given.menu[0].label === "Only");
  ok("an empty menu array falls back to the default", resolveTraySpec({ menu: [] }, actions).menu.length === 3);
  ok("a blank icon falls back to null", resolveTraySpec({ icon: "   " }, actions).icon === null);
}
export {
  defaultTrayMenu,
  resolveTraySpec,
  runTests
};
//# sourceMappingURL=trayModel.js.map
