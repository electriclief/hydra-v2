import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, readEnvFile } from "./server.js";
const MODULE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const HERMES_ENV = "C:/Users/User/AppData/Local/hermes/.env";
function nodeRefFromDisk() {
  for (const p of ["C:/AI/hydra-local/module/Menu/data/node.json", "C:/AI/hydra-local/module/Core/data/node.json"]) {
    try {
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      if (j.ref) return String(j.ref);
    } catch {
    }
  }
  return "local";
}
function parseArgs(argv, moduleDir = MODULE_DIR) {
  const options2 = {
    port: 8139,
    host: "127.0.0.1",
    dataDir: path.join(moduleDir, "data"),
    stateUrl: process.env.TELLMOM_STATE ?? "http://127.0.0.1:8127",
    nodeRef: process.env.TELLMOM_REF ?? nodeRefFromDisk(),
    envFile: process.env.TELLMOM_ENV ?? HERMES_ENV,
    paneUrl: process.env.TELLMOM_PANE ?? "http://127.0.0.1:8138"
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => String(argv[i + 1] ?? "");
    if (arg === "--port") {
      options2.port = Number.parseInt(next(), 10) || options2.port;
      i += 1;
    } else if (arg === "--host") {
      options2.host = next() || options2.host;
      i += 1;
    } else if (arg === "--data") {
      options2.dataDir = path.resolve(next());
      i += 1;
    } else if (arg === "--state") {
      options2.stateUrl = next() || options2.stateUrl;
      i += 1;
    } else if (arg === "--node-ref") {
      options2.nodeRef = next() || options2.nodeRef;
      i += 1;
    } else if (arg === "--env") {
      options2.envFile = path.resolve(next());
      i += 1;
    } else if (arg === "--pane") {
      options2.paneUrl = next() || options2.paneUrl;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Tell Mom \u2014 one verb, a policy, and a receipt",
          "",
          "  node public/js/main.js [options]",
          "",
          "  --port N        port (default 8139)",
          "  --host H        bind host (default 127.0.0.1)",
          "  --data DIR      policy.json + told.jsonl (default <module>/data)",
          "  --state URL     the State door (default 127.0.0.1:8127)",
          "  --node-ref REF  publish receipts under node.<REF>.told",
          "  --env FILE      the .env holding DISCORD_BOT_TOKEN (default the Hermes one)",
          "  --pane URL      the Echidna door used by the pane channel",
          ""
        ].join("\n")
      );
      process.exit(0);
    }
  }
  return options2;
}
const options = parseArgs(process.argv.slice(2));
const env = readEnvFile(options.envFile);
const server = createServer({
  port: options.port,
  host: options.host,
  dataDir: options.dataDir,
  stateUrl: options.stateUrl,
  nodeRef: options.nodeRef,
  env,
  channels: { envFile: options.envFile, paneUrl: options.paneUrl }
});
server.listen(options.port, options.host, () => {
  process.stdout.write(`[tellmom] http://${options.host}:${options.port}  (node ${options.nodeRef})
`);
  const hasDiscord = Boolean((env.DISCORD_BOT_TOKEN || "").trim());
  process.stdout.write(`[tellmom] discord: ${hasDiscord ? "token present" : "no token - pane only"}
`);
  process.stdout.write(`[tellmom] policy: ${path.join(options.dataDir, "policy.json")}
`);
});
export {
  parseArgs
};
//# sourceMappingURL=main.js.map
