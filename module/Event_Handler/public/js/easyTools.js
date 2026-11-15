const url = (envKey, fallback) => (process.env[envKey] || fallback).replace(/\/$/, "");
const TOT = () => url("HYDRA_TOT", "http://127.0.0.1:8135");
const PHOENIX = () => url("HYDRA_PHOENIX", "http://127.0.0.1:8146");
const ECHIDNA = () => url("HYDRA_MONITOR", "http://127.0.0.1:8138");
const PW = () => url("HYDRA_PW", "http://127.0.0.1:8125");
const STATE = () => url("HYDRA_STATE", "http://127.0.0.1:8127");
const JOIN = () => url("HYDRA_JOIN", "http://127.0.0.1:8131");
const CORE = () => url("HYDRA_CORE", "http://127.0.0.1:8136");
const MIRROR = () => url("HYDRA_MIRROR", "http://127.0.0.1:8137");
const EVENTS = () => url("HYDRA_EVENTS", "http://127.0.0.1:8126");
const MINERSTATE = () => url("HYDRA_MINERSTATE", "http://127.0.0.1:8147");
async function getJson(target, ms = 4e3) {
  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(target, { signal: ctl.signal });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `${target} answered HTTP ${res.status}` };
    return { ok: true, body: JSON.parse(text), ms: Date.now() - started };
  } catch (err) {
    const why = err instanceof Error ? err.name === "AbortError" ? `timeout after ${ms} ms` : err.message : String(err);
    return { ok: false, error: `${target} is not answering (${why})` };
  } finally {
    clearTimeout(timer);
  }
}
const refusal = (text) => ({ content: [{ type: "text", text }], isError: true });
const say = (text) => ({ content: [{ type: "text", text }] });
function buildEasyTools() {
  return [
    {
      name: "hydra_tot",
      description: "WHAT IS THE WORK \u2014 the train of thought as bullets (ref, state, title), one line per open intention, bounded to a couple of KB. Call this first on any question about what is next or what is owed. Read-only, no arguments.",
      inputSchema: { type: "object", properties: {} },
      run: async () => {
        const brief = await getJson(
          `${TOT()}/api/brief?states=blocked,active,open&limit=60`
        );
        if (!brief.ok) return refusal(`${brief.error} \u2014 the DAG door owns this answer; nothing else may stand in for it.`);
        return say(`${brief.body.count} intentions

${brief.body.text}`);
      }
    },
    {
      name: "hydra_phoenix",
      description: "WHAT UPKEEP IS DUE \u2014 the upkeep registry: interval, how many entries are registered and enabled, when the next beat lands, and each entry with the outcome of its last run. An entry that never ran says so. Read-only, no arguments.",
      inputSchema: { type: "object", properties: {} },
      run: async () => {
        const health = await getJson(`${PHOENIX()}/health`);
        if (!health.ok) return refusal(`${health.error} \u2014 upkeep is unknowable without the registry door.`);
        const list = await getJson(
          `${PHOENIX()}/api/entries`
        );
        const h = health.body;
        const lines = [
          `phoenix :${new URL(PHOENIX()).port} \u2014 every ${h.everyMin} min, ${h.beats} beat(s) this launch, next in ${Math.round((h.nextBeatInMs ?? 0) / 6e4)} min`,
          `${h.entries} registered \xB7 ${h.enabled} enabled`
        ];
        if (h.lastBeat?.at) lines.push(`last beat ${h.lastBeat.at} (${h.lastBeat.reason ?? "timer"}), ${h.lastBeat.ran ?? 0} ran`);
        if (!list.ok) {
          lines.push(`entries unreadable: ${list.error}`);
        } else {
          for (const row of list.body.rows) {
            const when = row.trigger?.every ? `every ${row.trigger.every}` : `on ${row.trigger?.on ?? "?"}`;
            const last = row.last ? `${row.last.outcome}${row.last.error ? ` (${row.last.error})` : ""} at ${row.last.ended}` : "never run";
            lines.push(`- ${row.id} [${row.enabled ? "on" : "off"}] ${when} \u2014 last: ${last}`);
          }
        }
        return say(lines.join("\n"));
      }
    },
    {
      name: "hydra_monitor",
      description: "THE TOP CARD \u2014 Echidna's board: where the work stands, the next thing, and what is waiting on the operator, exactly as it is displayed on this node. Read-only, no arguments.",
      inputSchema: { type: "object", properties: {} },
      run: async () => {
        const board = await getJson(
          `${ECHIDNA()}/api/billboard`
        );
        if (!board.ok) return refusal(`${board.error} \u2014 the board belongs to Echidna; this tool does not invent one.`);
        const pages = board.body.pages || [];
        if (!pages.length) return say("the board is empty \u2014 nothing composed, which is not the same as nothing to do");
        const text = pages.map((p) => `${p.title.toUpperCase()}
${p.lines.map((l) => `  - ${l}`).join("\n")}`).join("\n\n");
        return say(text);
      }
    },
    {
      name: "hydra_doors",
      description: "WHAT IS UP \u2014 this node's doors read from the process table that owns them: every running door with its port, plus any declared door that is failed or was killed. A door missing from both lists was never declared. Read-only, no arguments.",
      inputSchema: { type: "object", properties: {} },
      run: async () => {
        const table = await getJson(
          `${PW()}/api/processes`
        );
        if (!table.ok) return refusal(`${table.error} \u2014 the process table is the only honest answer to "what is up".`);
        const rows = table.body.processes || [];
        const doors = rows.filter((r) => r.tag === "door");
        const up = doors.filter((r) => r.life === "running");
        const down = doors.filter((r) => r.life !== "running");
        const line = (r) => {
          const port = r.name.split("-")[1] || "?";
          return `- ${r.name} :${port}${r.pid ? ` pid ${r.pid}` : ""}${r.life === "running" ? "" : ` \u2014 ${r.life}${r.error ? `: ${r.error}` : ""}`}`;
        };
        const lines = [`${up.length} door(s) running of ${doors.length} declared`];
        lines.push(...up.map(line));
        if (down.length) {
          lines.push(`${down.length} not running:`);
          lines.push(...down.map(line));
        }
        return say(lines.join("\n"));
      }
    },
    {
      name: "hydra_boot",
      description: "SESSION BOOT \u2014 one call, minimal: which doors answer, every node in one line (verdict + what it is doing right now), and the next few intentions. Run this FIRST in a new session, then claim what you are serving. Read-only, no arguments.",
      inputSchema: { type: "object", properties: {} },
      run: async () => {
        const lines = [];
        const probes = [
          ["state", `${STATE()}/api/state`],
          ["join", `${JOIN()}/api/members`],
          ["core", `${CORE()}/health`],
          ["mirror", `${MIRROR()}/health`],
          ["events", `${EVENTS()}/health`]
        ];
        const up = [];
        const down = [];
        for (const [name, target] of probes) {
          const r = await getJson(target, 1500);
          const port = new URL(target).port;
          if (r.ok || r.error && !/not answering/.test(r.error)) up.push(`${name} ${port}`);
          else down.push(`${name} ${port}`);
        }
        lines.push(`doors  : ${up.join(" \xB7 ") || "none"}${down.length ? `  |  DOWN: ${down.join(" \xB7 ")}` : ""}`);
        const lan = await getJson(`${MIRROR()}/api/lan.json`, 6e3);
        if (!lan.ok) {
          lines.push(`nodes  : unreadable \u2014 ${lan.error}`);
        } else {
          const nodes = lan.body.nodes ?? [];
          const absent = lan.body.declaredAbsent ?? [];
          lines.push(`nodes  : ${nodes.length} answering, ${absent.length} declared and absent`);
          for (const n of nodes) {
            const doors = n.doors ? `${n.doors.up}/${n.doors.count}` : "-";
            const st = n.standby;
            let doing = "idle";
            if (st && st.mode) {
              doing = st.mode === "mining" ? `mining ${st.algorithm ?? st.algo ?? ""} ${st.rate ?? ""}${st.accepted != null ? ` (${st.accepted} acc)` : ""}`.trim() : st.mode;
            } else if (n.services?.length) {
              doing = `${n.services.length} service(s)`;
            }
            const bits = [
              (n.ref ?? n.name ?? "?").padEnd(10),
              String(n.verdict ?? "?").padEnd(8),
              `doors ${doors}`.padEnd(11),
              (n.gpu ? String(n.gpu).slice(0, 22) : "").padEnd(23),
              doing
            ];
            lines.push(`  ${bits.join(" ")}`);
          }
          if (absent.length) {
            lines.push(`  absent: ${absent.map((a) => `${a.name ?? a.ref}${a.why ? ` (${a.why})` : ""}`).join(", ")}`);
          }
        }
        const miners = await getJson(`${MINERSTATE()}/state`, 4e3);
        if (miners.ok && Array.isArray(miners.body?.nodes) && miners.body.nodes.length) {
          for (const m of miners.body.nodes) {
            const line = m.readable ? `miners : ${String(m.node).padEnd(6)} ${String(m.miner ?? "").padEnd(9)} ${String(m.algo ?? "").padEnd(12)} ${String(m.hashrate ?? "").padEnd(10)} acc ${m.accepted ?? "?"} rej ${m.rejected ?? "?"}  ${m.pool ?? ""} (via ${m.via ?? "?"})` : `miners : ${String(m.node).padEnd(6)} NOT READABLE - ${m.why ?? "no miner answering"}`;
            lines.push(line);
          }
        } else if (!miners.ok) {
          lines.push(`miners : MinerState not answering (${miners.error})`);
        }
        const brief = await getJson(`${TOT()}/api/brief?states=blocked,active,open&limit=5`);
        if (brief.ok) {
          lines.push(`next   : ${brief.body.count} open intention(s)`);
          lines.push(
            ...String(brief.body.text).split("\n").filter((l) => l.trim()).slice(0, 8).map((l) => `  ${l.trim()}`)
          );
        } else {
          lines.push(`next   : unreadable \u2014 ${brief.error}`);
        }
        lines.push(
          "serve  : say which refs you are serving, and record it: node module/TrainOfThought/scripts/session-start.mjs --session <id> --take <refs>"
        );
        return say(lines.join("\n"));
      }
    }
  ];
}
export {
  buildEasyTools
};
//# sourceMappingURL=easyTools.js.map
