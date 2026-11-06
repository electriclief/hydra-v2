import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { createServiceCatalog } from "./serviceCatalog.js";
import { startApiServer } from "./apiServer.js";
const DEFAULTS = {
  port: 8128,
  host: "127.0.0.1",
  token: null,
  dir: "./services",
  quiet: false
};
function parseArgs(argv, env = process.env) {
  const options = { ...DEFAULTS };
  const envPort = Number.parseInt((env.SERVICES_PORT ?? "").trim(), 10);
  if (Number.isFinite(envPort) && envPort > 0) options.port = envPort;
  options.host = (env.SERVICES_HOST ?? "").trim() || options.host;
  options.token = (env.SERVICES_TOKEN ?? "").trim() || null;
  options.dir = (env.SERVICES_DIR ?? "").trim() || options.dir;
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
    } else if (arg === "--dir") {
      options.dir = next().trim() || options.dir;
      i++;
    } else if (arg === "--quiet" || arg === "-q") options.quiet = true;
  }
  return { options, help };
}
function printHelp() {
  console.log(
    [
      "services \u2014 the definitions of a run (one tiny .js data file per service; nothing runs here)",
      "",
      "Usage: node public/js/main.js [flags]",
      "",
      "  --port <n>    port to serve on            (default 8128, env SERVICES_PORT)",
      "  --host <ip>   interface to bind           (default 127.0.0.1, env SERVICES_HOST)",
      "  --dir <path>  the folder that IS the catalog (default ./services, env SERVICES_DIR)",
      "  --token <s>   shared token for /api/* and /mcp (env SERVICES_TOKEN)",
      "  --quiet       no banner",
      "  --help        this text",
      "",
      "Doors:  / (the page) \xB7 /health \xB7 /api/services \xB7 /api/services/:name \xB7",
      "        /api/services/:name/ad \xB7 /api/services/:name/inputs \xB7 POST /api/services/reload \xB7 /api/services/validate \xB7",
      "        /mcp (services_list \xB7 services_get \xB7 services_ad \xB7 services_inputs \xB7 services_reload \xB7 services_validate)"
    ].join("\n")
  );
}
function shelfRootOf(servicesDir) {
  const candidate = path.resolve(servicesDir, "..", "..", "..");
  return fs.existsSync(path.join(candidate, "module")) ? candidate : void 0;
}
async function startServices(overrides = {}) {
  const options = { ...DEFAULTS, ...overrides };
  options.dir = path.resolve(options.dir);
  const catalog = createServiceCatalog({ dir: options.dir });
  const api = await startApiServer({
    catalog,
    port: options.port,
    host: options.host,
    token: options.token,
    publicDir: path.join(process.cwd(), "public"),
    // The shelf this catalog lives inside, so the node can report a revision and pull a newer one. Derived from
    // the services folder (<shelf>/module/Services/services) and only accepted when a module/ tree is actually
    // there - a wrong guess would offer a revision that is not ours.
    shelfRoot: process.env.SERVICES_SHELF ?? shelfRootOf(options.dir),
    shelfLabel: process.env.SERVICES_SHELF_LABEL ?? ""
  });
  if (!options.quiet) {
    const entries = catalog.entries();
    console.log(`services \u2014 the definitions of a run \xB7 http://${api.url.replace(/^http:\/\//, "")}`);
    console.log(`  catalog   ${options.dir} \u2014 ${entries.filter((e) => e.ok).length} services, ${entries.filter((e) => !e.ok).length} refused (the folder IS the catalog)`);
    console.log("  page      /        \u2014 the catalog, its detail, its refusals");
    console.log("  api       /api/services \xB7 /api/services/:name \xB7 /api/services/:name/ad \xB7 /api/services/:name/inputs \xB7 POST /api/services/reload \xB7 /api/services/validate");
    console.log("  agent     POST /mcp \u2014 services_list \xB7 services_get \xB7 services_ad \xB7 services_inputs \xB7 services_reload \xB7 services_validate");
    console.log("  note      nothing runs here \u2014 a service DECLARES; the Scheduler books and runs, later");
  }
  return {
    catalog,
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
  const running = await startServices(options);
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
  const fs2 = await import("node:fs");
  const os = await import("node:os");
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const plain = parseArgs([]);
  ok("defaults: port 8128 \xB7 ./services \xB7 localhost", plain.options.port === 8128 && plain.options.dir === "./services" && plain.options.host === "127.0.0.1" && plain.options.token === null);
  const flagged = parseArgs(["--port", "9001", "--dir", "C:/tmp/svc", "--token", "sek", "--quiet"]);
  ok("flags carry", flagged.options.port === 9001 && flagged.options.dir === "C:/tmp/svc" && flagged.options.token === "sek" && flagged.options.quiet === true);
  const fromEnv = parseArgs([], { SERVICES_PORT: "9100", SERVICES_DIR: "C:/e", SERVICES_TOKEN: "envtok" });
  ok("environment carries", fromEnv.options.port === 9100 && fromEnv.options.dir === "C:/e" && fromEnv.options.token === "envtok");
  const override = parseArgs(["--port", "9200"], { SERVICES_PORT: "9100" });
  ok("a flag beats the environment", override.options.port === 9200);
  const junk = parseArgs(["--port", "abc", "--nope"], {});
  ok("junk falls back to defaults", junk.options.port === 8128 && junk.help === false);
  const help = parseArgs(["--help"]);
  ok("--help is recognized", help.help === true);
  const dir = fs2.mkdtempSync(path.join(os.tmpdir(), "svc-main-"));
  fs2.writeFileSync(path.join(dir, "demo.js"), 'module.exports = { name: "demo", advert: { what: "a demo" }, provider: { name: "demo app" }, pages: { ad: "<h1>demo</h1>", inputs: "<h1>in</h1>" } };');
  const running = await startServices({ port: 0, dir, quiet: true });
  const health = await (await fetch(running.api.url + "/health")).json();
  ok("startServices boots for real", health.ok === true && health.services === 1, JSON.stringify(health));
  const ad = (await (await fetch(running.api.url + "/api/services/demo/ad")).text()).includes("<h1>demo</h1>");
  ok("the ad page answers on the booted port", ad);
  const inPage = (await (await fetch(running.api.url + "/api/services/demo/inputs")).text()).includes("<h1>in</h1>");
  ok("the inputs page answers on the booted port", inPage);
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
  startServices
};
//# sourceMappingURL=main.js.map
