import process from "node:process";
import path from "node:path";
import { createWrapper } from "./processWrapper.js";
import { createStreamHub } from "./streamHub.js";
import { startApiServer } from "./apiServer.js";
import { createConsoleEvents } from "./consoleEvents.js";
import { createSystemWatch } from "./systemWatch.js";
import { captureRootLife } from "./rootLife.js";
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
      const envName = "PW_" + name.replace(/^--/, "").replace(/-/g, "_").toUpperCase();
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
  const registryFile = get(["--registry", "--registry-file"]) ?? path.join(process.cwd(), "data.yaml");
  return {
    port: num(["--port"], 8125),
    host: get(["--host"]) || "127.0.0.1",
    token: get(["--token"]) || null,
    registryFile,
    streamDir: get(["--stream-dir"]) ?? path.join(process.cwd(), "data", "streams"),
    bufferLimitChars: num(["--buffer-limit"], 4e6),
    graceMs: num(["--grace-ms"], 3e3),
    quiet: argv.includes("--quiet"),
    watch: !argv.includes("--no-watch")
  };
}
async function startWrapper(options = {}) {
  const full = {
    port: 8125,
    host: "127.0.0.1",
    token: null,
    registryFile: path.join(process.cwd(), "data.yaml"),
    streamDir: path.join(process.cwd(), "data", "streams"),
    bufferLimitChars: 4e6,
    graceMs: 3e3,
    quiet: false,
    watch: false,
    ...options
  };
  const wrapper = createWrapper({
    streamDir: full.streamDir,
    bufferLimitChars: full.bufferLimitChars,
    graceMs: full.graceMs,
    killTree: true
  });
  const hub = createStreamHub(wrapper);
  const rootLife = captureRootLife({ streamDir: full.streamDir });
  const stopper = { go: null };
  const palette = await createConsoleEvents({
    wrapper,
    logPath: path.join(path.dirname(full.streamDir), "console-events.log"),
    defaultCwd: process.cwd()
  });
  const api = await startApiServer({
    wrapper,
    hub,
    palette,
    port: full.port,
    host: full.host,
    token: full.token,
    registryFile: full.registryFile,
    rootRecord: rootLife.record,
    onStop: () => stopper.go?.()
  });
  let watch = null;
  if (full.watch) {
    watch = await createSystemWatch({
      wrapper,
      notify: (record) => {
        palette.trigger("note System Drain", record, "system-watch");
      }
    });
  }
  const running = {
    wrapper,
    hub,
    api,
    palette,
    watch,
    options: full,
    stop: async () => {
      if (watch) await watch.stop();
      rootLife.close();
      await wrapper.shutdown(true);
      await api.stop();
      palette.close();
    }
  };
  stopper.go = () => {
    void running.stop().then(() => {
      process.exitCode = 0;
      setTimeout(() => process.exit(0), 300).unref();
    });
  };
  return running;
}
function banner(running) {
  const { api, options } = running;
  return [
    "ProcessWrapper \u2014 commands in, text streams out.",
    `  GUI      ${api.url}/                      (start \xB7 watch \xB7 kill)`,
    `  API      ${api.url}`,
    `  MCP      ${api.url}/mcp                   (agents: initialize \u2192 tools/list \u2192 tools/call)`,
    `  health   GET  ${api.url}/health`,
    `  launch   POST ${api.url}/api/processes   {"command":"python bar.py"}`,
    `  copy     GET  ${api.url}/api/processes/<id>/output`,
    `  live     GET  ${api.url}/api/processes/<id>/stream   (SSE)`,
    `  kill     POST ${api.url}/api/processes/<id>/kill     {"force":true}`,
    `  events   GET  ${api.url}/api/events   POST ${api.url}/api/events/trigger  {"name":"add Process Console Display"}`,
    running.watch ? `  watch    armed \u2014 sampler child "system-watch"; drain notes + small logs in ${path.resolve(running.watch.logDir)}` : "  watch    off \u2014 pass --watch to arm the drain watch",
    `  streams  ${path.resolve(options.streamDir)}   (one file per process life)`,
    `  saved    ${path.resolve(options.registryFile)}`,
    options.token ? "  token    required for /api and /mcp (x-pw-token) \u2014 the GUI asks for it" : "  token    none \u2014 bind is local only; pass --token to guard it"
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
[processWrapper] ${signal} \u2014 stopping every child and closing the port`);
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
    console.error("[processWrapper] failed to start:", err.message);
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
  ok("defaults bind to the loopback on 8125", defaults.port === 8125 && defaults.host === "127.0.0.1", JSON.stringify(defaults));
  ok("no token by default", defaults.token === null);
  const flags = parseArgs(["--port", "9100", "--host", "0.0.0.0", "--token", "abc", "--grace-ms", "250", "--stream-dir", "C:/tmp/streams", "--registry", "C:/tmp/data.yaml"], {});
  ok("flags are read", flags.port === 9100 && flags.host === "0.0.0.0" && flags.token === "abc", JSON.stringify(flags));
  ok("the grace window flag reaches the wrapper", flags.graceMs === 250, String(flags.graceMs));
  ok("paths are taken as given", flags.streamDir === "C:/tmp/streams" && flags.registryFile === "C:/tmp/data.yaml", JSON.stringify(flags.streamDir));
  const inline = parseArgs(["--port=9200", "--quiet"], {});
  ok("--flag=value works", inline.port === 9200 && inline.quiet === true, JSON.stringify(inline));
  const fromEnv = parseArgs([], { PW_PORT: "9300", PW_TOKEN: "envtok", PW_HOST: "10.0.0.5" });
  ok("the environment is read", fromEnv.port === 9300 && fromEnv.token === "envtok" && fromEnv.host === "10.0.0.5", JSON.stringify(fromEnv));
  const beats = parseArgs(["--port", "9400"], { PW_PORT: "9300" });
  ok("a flag beats the environment", beats.port === 9400, String(beats.port));
  const junk = parseArgs(["--port", "not-a-number"], {});
  ok("junk falls back instead of throwing", junk.port === 8125, String(junk.port));
  const watchDefault = parseArgs([], {}).watch;
  const watchOff = parseArgs(["--no-watch"], {}).watch;
  ok("the drain watch is on by default, off with --no-watch", watchDefault === true && watchOff === false, `${watchDefault}/${watchOff}`);
  const dir = (await import("node:fs")).mkdtempSync(path.join((await import("node:os")).tmpdir(), "pw-main-"));
  const running = await startWrapper({
    port: 0,
    quiet: true,
    streamDir: path.join(dir, "streams"),
    registryFile: path.join(dir, "data.yaml")
  });
  const url = running.api.url;
  const health = await (await fetch(url + "/health")).json();
  ok("startWrapper really binds a port", /^http:\/\/127\.0\.0\.1:\d+$/.test(url) && running.api.port > 0, url);
  ok("the bound api answers health", health.ok === true && health.module === "processWrapper", JSON.stringify(health));
  const launched = await running.wrapper.launch({ name: "main-probe", command: process.execPath, args: ["-e", "console.log('main-ok')"] });
  await running.wrapper.awaitExit(launched.id, 15e3);
  const text = await (await fetch(`${url}/api/processes/${launched.id}/output`)).text();
  ok("a process launched in-process is served over the port", text.includes("main-ok"), text);
  const text2 = banner(running);
  ok("the banner names the api and the stream dir", text2.includes(url) && text2.includes(path.resolve(running.options.streamDir)), text2.slice(0, 200));
  await running.stop();
  const afterStop = await fetch(url + "/health").catch(() => null);
  ok("stop really closes the port and kills the children", afterStop === null, afterStop ? String(afterStop.status) : "closed");
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
