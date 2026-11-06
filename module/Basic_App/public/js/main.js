import { createBasicServer } from "./basicServer.js";
function flag(name, fallback) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--" + name);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1] ?? null;
  const eq = argv.find((a) => a.startsWith("--" + name + "="));
  if (eq) return eq.slice(name.length + 3) || null;
  return fallback;
}
const port = Number(flag("port", process.env.BASIC_PORT ?? "8130") ?? "8130");
const host = flag("host", process.env.BASIC_HOST ?? "127.0.0.1") ?? "127.0.0.1";
const config = {
  servicesUrl: flag("services", process.env.BASIC_SERVICES_URL ?? "http://127.0.0.1:8128") ?? "http://127.0.0.1:8128",
  pwUrl: flag("pw", process.env.BASIC_PW_URL ?? "http://127.0.0.1:8125") ?? "http://127.0.0.1:8125",
  rmUrl: flag("rm", process.env.BASIC_RM_URL ?? "http://127.0.0.1:8129") ?? "http://127.0.0.1:8129",
  stateUrl: flag("state", process.env.BASIC_STATE_URL ?? "http://127.0.0.1:8127") ?? "http://127.0.0.1:8127"
};
const server = await createBasicServer({ doors: config, port, host });
console.log(`[Basic_App] UI + API on ${server.url}`);
console.log(`[Basic_App]   services \u2192 ${config.servicesUrl}   pw \u2192 ${config.pwUrl}`);
console.log(`[Basic_App]   rm \u2192 ${config.rmUrl}   state \u2192 ${config.stateUrl}`);
const bye = async () => {
  await server.stop();
  process.exit(0);
};
process.on("SIGINT", () => void bye());
process.on("SIGTERM", () => void bye());
//# sourceMappingURL=main.js.map
