import process from "node:process";
import { createStateRegistry } from "./stateRegistry.js";
import { startApiServer } from "./apiServer.js";
function parseArgs(argv, env = process.env) {
  const get = (names) => {
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      for (const name of names) {
        if (arg === name) return argv[i + 1] ?? "";
        if (arg.startsWith(name + "=")) return arg.slice(name.length + 1);
      }
    }
    for (const name of names) {
      const envName = "STATE_" + name.replace(/^--/, "").replace(/-/g, "_").toUpperCase();
      if (env[envName]) return String(env[envName]);
    }
    return null;
  };
  const num = (names, fallback) => {
    const raw = get(names);
    if (raw === null || raw === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    port: num(["--port"], 8127),
    host: get(["--host"]) || "127.0.0.1",
    token: get(["--token"]) || null,
    quiet: argv.includes("--quiet")
  };
}
async function startState(options = {}) {
  const full = {
    port: 8127,
    host: "127.0.0.1",
    token: null,
    quiet: false,
    ...options
  };
  const state = createStateRegistry();
  const api = await startApiServer({
    state,
    port: full.port,
    host: full.host,
    token: full.token
  });
  return {
    state,
    api,
    options: full,
    stop: async () => {
      await api.stop();
      state.close();
    }
  };
}
function banner(running) {
  const { api } = running;
  return [
    "State \u2014 register \xB7 pull \xB7 discover \xB7 relay.",
    `  GUI      ${api.url}/                          (the held set + the pull bench)`,
    `  list     GET  ${api.url}/api/state            (?q=path|leaf|parent)`,
    `  pull     GET  ${api.url}/api/state/pull       (?name=...&marks={"key":N})`,
    `  register POST ${api.url}/api/state/register   {"name":"...","content":{...}}`,
    `  drop     POST ${api.url}/api/state/drop       {"name":"..."}`,
    `  live     GET  ${api.url}/api/state/stream     (SSE \u2014 the change feed)`,
    `  MCP      POST ${api.url}/mcp                   (agents: initialize \u2192 tools/list \u2192 tools/call)`,
    "  hold     nothing persists \u2014 the registry boots blank; entries live with their registrants",
    running.options.token ? "  token    required for /api and /mcp (x-state-token) \u2014 the GUI asks for it" : "  token    none \u2014 bind is local only; pass --token to guard it"
  ].join("\n");
}
async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const running = await startState(options);
  if (!options.quiet) {
    console.log(banner(running));
    console.log("  stop     Ctrl+C");
  }
  const shutdown = async (signal) => {
    if (!options.quiet) console.log(`
[state] ${signal} \u2014 closing the door`);
    await running.stop();
    process.exitCode = 0;
    setTimeout(() => process.exit(0), 2e3).unref();
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  return running;
}
function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return /main\.(js|ts)$/.test(entry);
}
if (isDirectRun()) {
  main().catch((err) => {
    console.error("[state] failed to start:", err.message);
    process.exit(1);
  });
}
async function runTests() {
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const defaults = parseArgs([], {});
  ok("defaults bind the loopback on 8127", defaults.port === 8127 && defaults.host === "127.0.0.1", JSON.stringify(defaults));
  ok("no token by default", defaults.token === null);
  const flags = parseArgs(["--port", "9100", "--token", "abc"], {});
  ok("flags are read", flags.port === 9100 && flags.token === "abc");
  const inline = parseArgs(["--port=9200", "--quiet"], {});
  ok("--flag=value works", inline.port === 9200 && inline.quiet === true);
  const fromEnv = parseArgs([], { STATE_PORT: "9300", STATE_HOST: "0.0.0.0", STATE_TOKEN: "envtok" });
  ok("the environment is read", fromEnv.port === 9300 && fromEnv.host === "0.0.0.0" && fromEnv.token === "envtok");
  const beats = parseArgs(["--port", "9400"], { STATE_PORT: "9300" });
  ok("a flag beats the environment", beats.port === 9400);
  const junk = parseArgs(["--port", "not-a-number"], {});
  ok("junk falls back instead of throwing", junk.port === 8127);
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[main] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  banner,
  main,
  parseArgs,
  runTests,
  startState
};
//# sourceMappingURL=main.js.map
