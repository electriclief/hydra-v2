import process from "node:process";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { createEventHandler } from "./eventHandler.js";
import { startApiServer } from "./apiServer.js";

/**
 * Register the names in data/palette.json. Missing file is normal (a bare node). A name already registered is
 * left alone, so a module that registers itself in-process and a palette entry can coexist.
 */
function loadPalette(handler, file = path.join(process.cwd(), "data", "palette.json")) {
  if (!existsSync(file)) return 0;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return 0;
  }
  let added = 0;
  for (const ev of Array.isArray(parsed?.events) ? parsed.events : []) {
    const name = typeof ev?.name === "string" ? ev.name : "";
    if (!name || handler.has(name)) continue;
    handler.register(name, () => ({ ok: true }), {
      description: typeof ev.description === "string" ? ev.description : "",
      producer: typeof ev.producer === "string" ? ev.producer : "any",
    });
    added += 1;
  }
  return added;
}
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
      const envName = "EH_" + name.replace(/^--/, "").replace(/-/g, "_").toUpperCase();
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
    port: num(["--port"], 8126),
    host: get(["--host"]) || "127.0.0.1",
    token: get(["--token"]) || null,
    logPath: get(["--log", "--log-path"]) ?? path.join(process.cwd(), "data", "events.log"),
    retentionHours: num(["--retention-hours"], 24),
    maxBytes: num(["--max-bytes"], 8e6),
    quiet: argv.includes("--quiet")
  };
}
async function startWrapper(options = {}) {
  const full = {
    port: 8126,
    host: "127.0.0.1",
    token: null,
    logPath: path.join(process.cwd(), "data", "events.log"),
    retentionHours: 24,
    maxBytes: 8e6,
    quiet: false,
    ...options
  };
  const handler = createEventHandler({
    logPath: full.logPath,
    retentionHours: full.retentionHours,
    maxBytes: full.maxBytes
  });

  /**
   * THE PALETTE FROM DISK. An event is a notice that something happened, so its handler here is deliberately a
   * no-op: the record is the log line. Declaring names in data/palette.json is what lets an OUT-OF-PROCESS
   * producer fire them - the PowerShell standby guard, the shelf puller - without adding code to this process.
   */
  loadPalette(handler);

  handler.start();
  const api = await startApiServer({
    handler,
    port: full.port,
    host: full.host,
    token: full.token
  });
  return {
    handler,
    api,
    options: full,
    stop: async () => {
      await api.stop();
      handler.close();
    }
  };
}
function banner(running) {
  const { api, options } = running;
  return [
    "Event_Handler \u2014 register \xB7 trigger \xB7 log.",
    `  GUI      ${api.url}/                          (the palette + the live log)`,
    `  API      GET  ${api.url}/api/events            (the palette)`,
    `  fire     POST ${api.url}/api/events/trigger   {"name":"...","payload":{}}`,
    `  read     GET  ${api.url}/api/events/log        (?limit=&name=&source=)`,
    `  live     GET  ${api.url}/api/events/stream     (SSE)`,
    `  trim     POST ${api.url}/api/events/purge`,
    `  MCP      POST ${api.url}/mcp                   (agents: initialize \u2192 tools/list \u2192 tools/call)`,
    `  log      ${path.resolve(options.logPath)}   (one rolling file, ~${options.retentionHours} h)`,
    options.token ? "  token    required for /api and /mcp (x-eh-token) \u2014 the GUI asks for it" : "  token    none \u2014 bind is local only; pass --token to guard it"
  ].join("\n");
}
async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const running = await startWrapper(options);
  if (!options.quiet) {
    console.log(banner(running));
    console.log("  stop     Ctrl+C");
  }
  const shutdown = async (signal) => {
    if (!options.quiet) console.log(`
[eventHandler] ${signal} \u2014 closing the door`);
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
    console.error("[eventHandler] failed to start:", err.message);
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
  ok("defaults bind the loopback on 8126", defaults.port === 8126 && defaults.host === "127.0.0.1", JSON.stringify(defaults));
  ok("the default log lands under data/", defaults.logPath.endsWith(path.join("data", "events.log")), defaults.logPath);
  ok("default retention ~24 h", defaults.retentionHours === 24 && defaults.maxBytes === 8e6);
  const flags = parseArgs(["--port", "9100", "--log", "C:/tmp/ev.log", "--retention-hours", "6", "--token", "abc"], {});
  ok("flags are read", flags.port === 9100 && flags.logPath === "C:/tmp/ev.log" && flags.retentionHours === 6 && flags.token === "abc");
  const inline = parseArgs(["--port=9200", "--quiet"], {});
  ok("--flag=value works", inline.port === 9200 && inline.quiet === true);
  const fromEnv = parseArgs([], { EH_PORT: "9300", EH_LOG: "C:/env/ev.log", EH_TOKEN: "envtok" });
  ok("the environment is read", fromEnv.port === 9300 && fromEnv.logPath === "C:/env/ev.log" && fromEnv.token === "envtok");
  const beats = parseArgs(["--port", "9400"], { EH_PORT: "9300" });
  ok("a flag beats the environment", beats.port === 9400);
  const junk = parseArgs(["--port", "not-a-number"], {});
  ok("junk falls back instead of throwing", junk.port === 8126);
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[main] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  banner,
  main,
  parseArgs,
  runTests,
  startWrapper
};
//# sourceMappingURL=main.js.map
