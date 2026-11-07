import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "./server.js";
const MODULE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RIG_HERMES = "C:/Users/User/AppData/Local/hermes/hermes-agent/.hermes/bin/hermes.exe";
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
function defaultAgentBin() {
  const fromEnv = process.env.ECHIDNA_HERMES;
  if (fromEnv) return fromEnv;
  if (fs.existsSync(RIG_HERMES)) return RIG_HERMES;
  return "hermes";
}
function parseArgs(argv, moduleDir = MODULE_DIR) {
  const options2 = {
    port: 8138,
    host: "127.0.0.1",
    publicDir: path.join(moduleDir, "public"),
    dataDir: path.join(moduleDir, "data"),
    agentBin: defaultAgentBin(),
    timeoutMs: 3e5,
    stateUrl: process.env.ECHIDNA_STATE ?? "http://127.0.0.1:8127",
    nodeRef: process.env.ECHIDNA_REF ?? nodeRefFromDisk(),
    mirrorUrl: process.env.ECHIDNA_MIRROR ?? "http://127.0.0.1:8137",
    readOnly: process.env.ECHIDNA_READONLY === "1",
    rigDir: process.env.ECHIDNA_RIG ?? "C:/AI/hydra-local/media/characters"
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
    } else if (arg === "--agent") {
      options2.agentBin = next() || options2.agentBin;
      i += 1;
    } else if (arg === "--state") {
      options2.stateUrl = next() || options2.stateUrl;
      i += 1;
    } else if (arg === "--node-ref") {
      options2.nodeRef = next() || options2.nodeRef;
      i += 1;
    } else if (arg === "--view") {
      options2.readOnly = true;
      i += 1;
    } else if (arg === "--timeout") {
      options2.timeoutMs = (Number.parseInt(next(), 10) || 300) * 1e3;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Echidna \u2014 the agent face of this LAN",
          "",
          "  node public/js/main.js [options]",
          "",
          "  --port N      port (default 8138)",
          "  --host H      bind host (default 127.0.0.1; 0.0.0.0 for the LAN)",
          "  --data DIR    thread.jsonl + easy.json live here (default <module>/data)",
          "  --agent EXE   hermes binary (default this rig, then PATH)",
          "  --timeout S   seconds one answer may take (default 300)",
          ""
        ].join("\n")
      );
      process.exit(0);
    }
  }
  return options2;
}
const options = parseArgs(process.argv.slice(2));
const server = createServer({
  port: options.port,
  host: options.host,
  publicDir: options.publicDir,
  dataDir: options.dataDir,
  agent: { bin: options.agentBin, promptDir: path.join(options.dataDir, "prompts"), timeoutMs: options.timeoutMs },
  stateUrl: options.stateUrl,
  nodeRef: options.nodeRef,
  mirrorUrl: options.mirrorUrl,
  readOnly: options.readOnly,
  rigDir: options.rigDir
});
server.listen(options.port, options.host, () => {
  process.stdout.write(`[echidna] http://${options.host}:${options.port}
`);
  process.stdout.write(`[echidna] agent: ${options.agentBin}${fs.existsSync(options.agentBin) ? "" : " (NOT FOUND)"}
`);
  process.stdout.write(`[echidna] thread: ${path.join(options.dataDir, "thread.jsonl")}
`);
  process.stdout.write(`[echidna] published as node.${options.nodeRef}.echidna to ${options.stateUrl}
`);
  process.stdout.write(`[echidna] faces: ${options.rigDir}
`);
});
export {
  parseArgs
};
//# sourceMappingURL=main.js.map
