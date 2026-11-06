import path from "node:path";
import { createMcpServer, ToolError } from "./mcpServer.js";
import { loadRegistry, saveRegistry, addCommand, removeCommand, getCommand } from "./registryStore.js";
function createFileBridge(file) {
  const state = loadRegistry(file).state;
  return {
    list: () => state.commands ?? [],
    find: (name) => getCommand(state, name),
    add: (def) => {
      const created = addCommand(state, def);
      saveRegistry(file, state);
      return created;
    },
    remove: (name) => {
      const removed = removeCommand(state, name);
      if (removed) saveRegistry(file, state);
      return removed;
    }
  };
}
function createPwMcpRegistry(options) {
  const bridge = options.registry ?? createFileBridge(options.registryFile ?? path.join(process.cwd(), "data.yaml"));
  const server = createMcpServer({
    wrapper: options.wrapper,
    hub: options.hub,
    registry: bridge,
    endpoint: options.endpoint
  });
  return {
    module: "process-wrapper",
    list: () => server.tools(),
    call: (name, args = {}, ctx) => server.call(name, args, ctx)
  };
}
async function runTests() {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const { createWrapper } = await import("./processWrapper.js");
  const { createStreamHub } = await import("./streamHub.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-registry-"));
  const wrapper = createWrapper({ streamDir: path.join(dir, "streams"), graceMs: 300 });
  const hub = createStreamHub(wrapper);
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const registry = createPwMcpRegistry({ wrapper, hub, registryFile: path.join(dir, "data.yaml") });
  ok("the registry names its module", registry.module === "process-wrapper");
  const tools = registry.list();
  ok("the whole tool table is on it", tools.length >= 13, tools.map((t) => t.name).join(","));
  ok("no run hands leak into the list", tools.every((t) => !("run" in t)));
  ok("every tool is self-described", tools.every((t) => t.description.length > 20 && t.inputSchema.type === "object"));
  const health = await registry.call("pw_health");
  ok("the call hand runs a real tool", health.content[0].text.length > 10, health.content[0].text.slice(0, 80));
  let refused = false;
  try {
    await registry.call("pw_teleport", {});
  } catch (err) {
    refused = err instanceof ToolError && err.message.includes("available");
  }
  ok("an unknown tool throws ToolError naming the list", refused);
  const launched = await registry.call("pw_launch", {
    command: process.execPath,
    args: ["-e", "console.log('registry-ok')"],
    name: "reg-probe"
  });
  const record = launched.structuredContent;
  const id = record?.process?.id;
  ok("pw_launch through the registry answers a record", typeof id === "string", launched.content[0].text.slice(0, 120));
  if (id) {
    await wrapper.awaitExit(id, 15e3);
    const out = await registry.call("pw_output", { id });
    ok("the outcome text comes back through the registry", out.content[0].text.includes("registry-ok"), out.content[0].text.slice(0, 80));
  } else {
    ok("the outcome text comes back through the registry", false, "no id from pw_launch");
  }
  await wrapper.shutdown(true);
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[mcpRegistry] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  createFileBridge,
  createPwMcpRegistry,
  runTests
};
//# sourceMappingURL=mcpRegistry.js.map
