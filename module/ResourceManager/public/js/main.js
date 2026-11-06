import path from "node:path";
import { pathToFileURL } from "node:url";
import { createBookingStore } from "./bookingStore.js";
import { collectReads, loadShareList } from "./resourceRead.js";
import { startApiServer } from "./apiServer.js";
const DEFAULTS = {
  port: 8129,
  host: "127.0.0.1",
  token: null,
  dataDir: "./data",
  sharesFile: "",
  quiet: false
};
function parseArgs(argv, env = process.env) {
  const options = { ...DEFAULTS };
  const envPort = Number.parseInt((env.RM_PORT ?? "").trim(), 10);
  if (Number.isFinite(envPort) && envPort > 0) options.port = envPort;
  options.host = (env.RM_HOST ?? "").trim() || options.host;
  options.token = (env.RM_TOKEN ?? "").trim() || null;
  options.dataDir = (env.RM_DATA ?? "").trim() || options.dataDir;
  options.sharesFile = (env.RM_SHARES ?? "").trim() || options.sharesFile;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => String(argv[i + 1] ?? "");
    if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--port") {
      const port = Number.parseInt(next(), 10);
      if (Number.isFinite(port) && port >= 0) options.port = port;
      i++;
    } else if (arg === "--host") {
      options.host = next().trim() || options.host;
      i++;
    } else if (arg === "--token") {
      options.token = next().trim() || null;
      i++;
    } else if (arg === "--data") {
      options.dataDir = next().trim() || options.dataDir;
      i++;
    } else if (arg === "--shares") {
      options.sharesFile = next().trim() || options.sharesFile;
      i++;
    } else if (arg === "--quiet" || arg === "-q") options.quiet = true;
  }
  return { options, help };
}
function printHelp() {
  console.log(
    [
      "resource-manager \u2014 the register of this node (reads resources; keeps bookings; never locks, never enforces)",
      "",
      "Usage: node public/js/main.js [flags]",
      "",
      "  --port <n>     port to serve on              (default 8129, env RM_PORT)",
      "  --host <ip>    interface to bind             (default 127.0.0.1, env RM_HOST)",
      "  --data <path>  folder holding bookings.json  (default ./data, env RM_DATA)",
      "  --shares <f>   declared shared folders file  (default <data>/shares.json, env RM_SHARES)",
      "  --token <s>    shared token for /api/* and /mcp (env RM_TOKEN)",
      "  --quiet        no banner",
      "  --help         this text",
      "",
      "Doors:  / (the page) \xB7 /health \xB7 GET /api/resources \xB7 POST /api/resources/refresh \xB7",
      "        GET /api/bookings[/:id] \xB7 POST /api/book \xB7 POST /api/bookings/:id/pop \xB7 /clear \xB7",
      "        /mcp (rm_resources \xB7 rm_book \xB7 rm_bookings \xB7 rm_pop \xB7 rm_clear)"
    ].join("\n")
  );
}
async function startResourceManager(overrides = {}) {
  const options = { ...DEFAULTS, ...overrides };
  const dataDir = path.resolve(options.dataDir);
  const sharesFile = path.resolve(options.sharesFile || path.join(dataDir, "shares.json"));
  const shares = loadShareList(sharesFile);
  const collect = { shares };
  const reads = () => collectReads(collect);
  const refreshReads = () => collectReads({ ...collect, force: true });
  const store = createBookingStore({ dataDir, reads });
  const api = await startApiServer({
    store,
    reads,
    refreshReads,
    port: options.port,
    host: options.host,
    token: options.token,
    publicDir: path.join(process.cwd(), "public")
  });
  if (!options.quiet) {
    console.log(`resource-manager \u2014 the register \xB7 http://${api.url.replace(/^http:\/\//, "")}`);
    console.log(`  register  ${store.dataFile} \u2014 ${store.active().length} active booking(s)`);
    console.log(`  shares    ${sharesFile}${shares.length ? ` \u2014 ${shares.length} declared` : " \u2014 none declared (create it to list Hydra shared folders)"}`);
    console.log("  page      /        \u2014 the machine, the register, the book form");
    console.log("  api       GET /api/resources \xB7 POST /api/book \xB7 POST /api/bookings/:id/pop|clear \xB7 GET /api/bookings");
    console.log("  agent     POST /mcp \u2014 rm_resources \xB7 rm_book \xB7 rm_bookings \xB7 rm_pop \xB7 rm_clear");
    console.log("  note      it never locks and never enforces \u2014 it only won't allow double booking (voluntary all the way)");
  }
  return {
    store,
    api,
    options,
    stop: async () => {
      await api.stop();
    }
  };
}
async function main() {
  const { options, help } = parseArgs(process.argv.slice(2));
  if (help) {
    printHelp();
    return;
  }
  const running = await startResourceManager(options);
  const shutdown = async () => {
    await running.stop();
    setTimeout(() => process.exit(0), 2e3).unref();
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}
const isDirect = (() => {
  try {
    const entry = process.argv[1];
    return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
})();
if (isDirect) void main();
async function runTests() {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const plain = parseArgs([]);
  ok("defaults: port 8129 \xB7 ./data \xB7 localhost", plain.options.port === 8129 && plain.options.dataDir === "./data" && plain.options.host === "127.0.0.1" && plain.options.token === null);
  const flagged = parseArgs(["--port", "9001", "--data", "C:/tmp/rm", "--token", "sek", "--quiet"]);
  ok("flags carry", flagged.options.port === 9001 && flagged.options.dataDir === "C:/tmp/rm" && flagged.options.token === "sek" && flagged.options.quiet === true);
  const fromEnv = parseArgs([], { RM_PORT: "9100", RM_DATA: "C:/e", RM_TOKEN: "envtok" });
  ok("environment carries", fromEnv.options.port === 9100 && fromEnv.options.dataDir === "C:/e" && fromEnv.options.token === "envtok");
  const override = parseArgs(["--port", "9200"], { RM_PORT: "9100" });
  ok("a flag beats the environment", override.options.port === 9200);
  const junk = parseArgs(["--port", "abc", "--nope"], {});
  ok("junk falls back to defaults", junk.options.port === 8129 && junk.help === false);
  const help = parseArgs(["--help"]);
  ok("--help is recognized", help.help === true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rm-main-"));
  const running = await startResourceManager({ port: 0, dataDir: dir, quiet: true });
  const health = await (await fetch(running.api.url + "/health")).json();
  ok("startResourceManager boots for real", health.ok === true && health.module === "resource-manager", JSON.stringify(health));
  ok("the boot prints where its register lives", running.store.dataFile.startsWith(dir));
  await running.stop();
  let closed = false;
  try {
    await fetch(running.api.url + "/health");
  } catch {
    closed = true;
  }
  ok("stop closes the door", closed);
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[main] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  DEFAULTS,
  parseArgs,
  printHelp,
  runTests,
  startResourceManager
};
//# sourceMappingURL=main.js.map
