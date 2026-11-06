import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Scheduler, createDummyRunner } from "./scheduler.js";
import { createLocalRunner } from "./runner-local.js";
import { startApiServer } from "./apiServer.js";
import { refFromNodeJson, startPublisher } from "./publish.js";
const DEFAULTS = {
  port: 8132,
  host: "127.0.0.1",
  file: path.join(process.cwd(), "data", "jobs.json"),
  concurrency: 1,
  quiet: false,
  runner: "dummy",
  dataRoot: "C:/AI/hydra-local/data/jobs"
};
function parseArgs(argv, env = process.env) {
  const options = { ...DEFAULTS };
  const envPort = Number.parseInt((env.SCHEDULER_PORT ?? "").trim(), 10);
  if (Number.isFinite(envPort) && envPort > 0) options.port = envPort;
  options.host = (env.HOST ?? "").trim() || (env.SCHEDULER_HOST ?? "").trim() || options.host;
  const envFile = (env.SCHEDULER_FILE ?? "").trim();
  if (envFile) options.file = envFile;
  const envRunner = (env.SCHEDULER_RUNNER ?? "").trim().toLowerCase();
  if (envRunner === "local" || envRunner === "dummy") options.runner = envRunner;
  const envData = (env.SCHEDULER_DATA_ROOT ?? "").trim();
  if (envData) options.dataRoot = envData;
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
    } else if (arg === "--file") {
      options.file = next().trim() || null;
      i++;
    } else if (arg === "--memory") {
      options.file = null;
      i++;
    } else if (arg === "--concurrency") {
      const n = Number.parseInt(next(), 10);
      if (Number.isFinite(n) && n > 0) options.concurrency = n;
      i++;
    } else if (arg === "--quiet" || arg === "-q") options.quiet = true;
    else if (arg === "--runner") {
      const kind = next().trim().toLowerCase();
      if (kind === "local" || kind === "dummy") options.runner = kind;
      i++;
    } else if (arg === "--data-root") {
      options.dataRoot = next().trim() || options.dataRoot;
      i++;
    }
  }
  return { options, help };
}
function printHelp() {
  console.log(
    [
      "scheduler \u2014 the book of jobs, one at a time (the runner is a dummy today)",
      "",
      "Usage: node public/js/main.js [flags]",
      "",
      "  --port <n>         port to serve on        (default 8132, env SCHEDULER_PORT)",
      "  --host <ip>        interface to bind       (default 127.0.0.1, env SCHEDULER_HOST)",
      "  --file <path>      the book                (default ./data/jobs.json, env SCHEDULER_FILE)",
      "  --memory           keep the book in RAM only",
      "  --concurrency <n>  jobs at once            (default 1 \u2014 one GPU, one job)",
      "  --quiet            no banner",
      "  --help             this text",
      "",
      "Doors:  / (the book) \xB7 /health \xB7 /api/queue \xB7 /api/stats \xB7 GET|POST /api/jobs \xB7",
      "        GET /api/jobs/:id \xB7 POST /api/jobs/:id/cancel \xB7",
      "        /mcp (scheduler_submit \xB7 scheduler_jobs \xB7 scheduler_status)",
      "",
      "The runner is a DUMMY: it records the job and executes nothing. That is deliberate \u2014 the",
      "wiring (submit \xB7 queue \xB7 run \xB7 status) is real, so a real runner replaces one file."
    ].join("\n")
  );
}
async function startScheduler(overrides = {}) {
  const options = { ...DEFAULTS, ...overrides };
  if (options.file) options.file = path.resolve(options.file);
  const runner = options.runner === "local" ? createLocalRunner({ dataRoot: options.dataRoot, log: (line) => {
    if (!options.quiet) console.log(line);
  } }) : createDummyRunner();
  const scheduler = new Scheduler({
    file: options.file,
    concurrency: options.concurrency,
    runner
  });
  const moduleRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");
  const nodeRef = process.env.SCHEDULER_REF ?? refFromNodeJson(moduleRoot) ?? "scheduler";
  const standbyFile = path.resolve(moduleRoot, "..", "data", "standby", "guard.state.json");
  const api = await startApiServer({
    scheduler,
    port: options.port,
    host: options.host,
    ref: nodeRef,
    standbyFile,
    // the footer reads the same surface a peer would: this node's State, not a private file
    stateUrl: process.env.SCHEDULER_STATE_URL ?? "http://127.0.0.1:8127"
  });
  const publisher = startPublisher(
    {
      stateUrl: process.env.SCHEDULER_STATE_URL ?? "http://127.0.0.1:8127",
      ref: nodeRef,
      intervalMs: Number(process.env.SCHEDULER_PUBLISH_MS ?? 5e3),
      root: moduleRoot
    },
    () => scheduler.list({ limit: 200 }),
    () => scheduler.stats(),
    (line) => {
      if (!options.quiet) console.log(line);
    }
  );
  if (!options.quiet) {
    const stats = scheduler.stats();
    console.log(`scheduler \u2014 ${scheduler.describe()} \xB7 ${api.url}`);
    console.log(`  book      ${options.file ?? "in memory only"} \u2014 ${stats.total} job(s)`);
    console.log("  page      /  \u2014 the book, newest first");
    console.log("  api       POST /api/jobs {service, inputs, note} \xB7 GET /api/jobs \xB7 GET /api/jobs/:id \xB7 POST /api/jobs/:id/cancel \xB7 /api/queue \xB7 /api/stats");
    console.log("  agent     POST /mcp \u2014 scheduler_submit \xB7 scheduler_jobs \xB7 scheduler_status");
    console.log("  runner    DUMMY \u2014 it executes nothing, and says so. A real runner replaces createDummyRunner().");
  }
  return {
    scheduler,
    api,
    options,
    stop: async () => {
      publisher.stop();
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
  const running = await startScheduler(options);
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
export {
  DEFAULTS,
  parseArgs,
  printHelp,
  startScheduler
};
//# sourceMappingURL=main.js.map
