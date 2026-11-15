/**
 * @module easyTools
 * @description THE EASY BUTTONS — four zero-argument tools so a small local model can orient itself on this node in
 *              one call each, without a prose brief and without knowing a single port.
 * @intent Operator ruling (2026-11-06): "it should be MCP based, pointing at Hydra MCP - the easy button for any
 *         agent, even a tiny local model." A 2B model cannot be taught the fleet by lecture; it can be handed tools
 *         whose schemas take no arguments at all, so there is nothing to get wrong.
 *
 * Each tool is a SURFACE over a door that already owns the truth — it composes, it never recomputes:
 *   hydra_tot      -> TrainOfThought :8135/api/brief   (the DAG as bullets, the operator's reading level)
 *   hydra_phoenix  -> Phoenix :8146/health + /api/entries (upkeep due, last outcomes)
 *   hydra_monitor  -> Echidna :8138/api/billboard      (the board: where the work stands, what is next)
 *   hydra_doors    -> ProcessWrapper :8125/api/processes (what is actually up, from the table that owns it)
 *
 * A door that does not answer is a REFUSAL THAT NAMES THE ADDRESS (isError + the URL), never an empty list: a 200
 * carrying [] reads as "nothing to do", which is how a dead dependency hides for a week.
 */

import type { McpTool, McpToolResult } from './mcpTools.js';

const url = (envKey: string, fallback: string): string =>
  (process.env[envKey] || fallback).replace(/\/$/, '');

const TOT = () => url('HYDRA_TOT', 'http://127.0.0.1:8135');
const PHOENIX = () => url('HYDRA_PHOENIX', 'http://127.0.0.1:8146');
const ECHIDNA = () => url('HYDRA_MONITOR', 'http://127.0.0.1:8138');
const PW = () => url('HYDRA_PW', 'http://127.0.0.1:8125');
const STATE = () => url('HYDRA_STATE', 'http://127.0.0.1:8127');
const JOIN = () => url('HYDRA_JOIN', 'http://127.0.0.1:8131');
const CORE = () => url('HYDRA_CORE', 'http://127.0.0.1:8136');
const MIRROR = () => url('HYDRA_MIRROR', 'http://127.0.0.1:8137');
const EVENTS = () => url('HYDRA_EVENTS', 'http://127.0.0.1:8126');
const MINERSTATE = () => url('HYDRA_MINERSTATE', 'http://127.0.0.1:8147');

/** One GET with a hard timeout. Failure is a value, never an exception into the MCP frame. */
async function getJson<T>(target: string, ms = 4000): Promise<{ ok: true; body: T; ms: number } | { ok: false; error: string }> {
  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(target, { signal: ctl.signal });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `${target} answered HTTP ${res.status}` };
    return { ok: true, body: JSON.parse(text) as T, ms: Date.now() - started };
  } catch (err) {
    const why = err instanceof Error ? (err.name === 'AbortError' ? `timeout after ${ms} ms` : err.message) : String(err);
    return { ok: false, error: `${target} is not answering (${why})` };
  } finally {
    clearTimeout(timer);
  }
}

const refusal = (text: string): McpToolResult => ({ content: [{ type: 'text', text }], isError: true });
const say = (text: string): McpToolResult => ({ content: [{ type: 'text', text }] });

export function buildEasyTools(): McpTool[] {
  return [
    {
      name: 'hydra_tot',
      description:
        'WHAT IS THE WORK — the train of thought as bullets (ref, state, title), one line per open intention, bounded to a couple of KB. Call this first on any question about what is next or what is owed. Read-only, no arguments.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => {
        const brief = await getJson<{ ok: boolean; count: number; text: string }>(
          `${TOT()}/api/brief?states=blocked,active,open&limit=60`,
        );
        if (!brief.ok) return refusal(`${brief.error} — the DAG door owns this answer; nothing else may stand in for it.`);
        return say(`${brief.body.count} intentions\n\n${brief.body.text}`);
      },
    },
    {
      name: 'hydra_phoenix',
      description:
        'WHAT UPKEEP IS DUE — the upkeep registry: interval, how many entries are registered and enabled, when the next beat lands, and each entry with the outcome of its last run. An entry that never ran says so. Read-only, no arguments.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => {
        const health = await getJson<{
          ok: boolean; everyMin: number; entries: number; enabled: number; beats: number;
          nextBeatInMs: number; lastBeat?: { at?: string; reason?: string; ran?: number } | null;
        }>(`${PHOENIX()}/health`);
        if (!health.ok) return refusal(`${health.error} — upkeep is unknowable without the registry door.`);

        const list = await getJson<{ rows: Array<{ id: string; enabled: boolean; trigger: Record<string, string>; last: { outcome?: string; ended?: string; error?: string } | null }> }>(
          `${PHOENIX()}/api/entries`,
        );
        const h = health.body;
        const lines = [
          `phoenix :${new URL(PHOENIX()).port} — every ${h.everyMin} min, ${h.beats} beat(s) this launch, next in ${Math.round((h.nextBeatInMs ?? 0) / 60000)} min`,
          `${h.entries} registered · ${h.enabled} enabled`,
        ];
        if (h.lastBeat?.at) lines.push(`last beat ${h.lastBeat.at} (${h.lastBeat.reason ?? 'timer'}), ${h.lastBeat.ran ?? 0} ran`);
        if (!list.ok) {
          lines.push(`entries unreadable: ${list.error}`);
        } else {
          for (const row of list.body.rows) {
            const when = row.trigger?.every ? `every ${row.trigger.every}` : `on ${row.trigger?.on ?? '?'}`;
            const last = row.last ? `${row.last.outcome}${row.last.error ? ` (${row.last.error})` : ''} at ${row.last.ended}` : 'never run';
            lines.push(`- ${row.id} [${row.enabled ? 'on' : 'off'}] ${when} — last: ${last}`);
          }
        }
        return say(lines.join('\n'));
      },
    },
    {
      name: 'hydra_monitor',
      description:
        "THE TOP CARD — Echidna's board: where the work stands, the next thing, and what is waiting on the operator, exactly as it is displayed on this node. Read-only, no arguments.",
      inputSchema: { type: 'object', properties: {} },
      run: async () => {
        const board = await getJson<{ pages: Array<{ kind: string; title: string; lines: string[] }> }>(
          `${ECHIDNA()}/api/billboard`,
        );
        if (!board.ok) return refusal(`${board.error} — the board belongs to Echidna; this tool does not invent one.`);
        const pages = board.body.pages || [];
        if (!pages.length) return say('the board is empty — nothing composed, which is not the same as nothing to do');
        const text = pages.map((p) => `${p.title.toUpperCase()}\n${p.lines.map((l) => `  - ${l}`).join('\n')}`).join('\n\n');
        return say(text);
      },
    },
    {
      name: 'hydra_doors',
      description:
        'WHAT IS UP — this node\'s doors read from the process table that owns them: every running door with its port, plus any declared door that is failed or was killed. A door missing from both lists was never declared. Read-only, no arguments.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => {
        const table = await getJson<{ processes?: Array<{ name: string; tag?: string; life?: string; pid?: number; error?: string | null }> }>(
          `${PW()}/api/processes`,
        );
        if (!table.ok) return refusal(`${table.error} — the process table is the only honest answer to "what is up".`);
        const rows = table.body.processes || [];
        const doors = rows.filter((r) => r.tag === 'door');
        const up = doors.filter((r) => r.life === 'running');
        const down = doors.filter((r) => r.life !== 'running');
        const line = (r: { name: string; pid?: number; life?: string; error?: string | null }): string => {
          const port = r.name.split('-')[1] || '?';
          return `- ${r.name} :${port}${r.pid ? ` pid ${r.pid}` : ''}${r.life === 'running' ? '' : ` — ${r.life}${r.error ? `: ${r.error}` : ''}`}`;
        };
        const lines = [`${up.length} door(s) running of ${doors.length} declared`];
        lines.push(...up.map(line));
        if (down.length) {
          lines.push(`${down.length} not running:`);
          lines.push(...down.map(line));
        }
        return say(lines.join('\n'));
      },
    },
    {
      name: 'hydra_boot',
      description:
        'SESSION BOOT — one call, minimal: which doors answer, every node in one line (verdict + what it is doing right now), and the next few intentions. Run this FIRST in a new session, then claim what you are serving. Read-only, no arguments.',
      inputSchema: { type: 'object', properties: {} },
      run: async () => {
        const lines: string[] = [];

        // 1. doors - a boot report that cannot say what is up is not a boot report
        const probes: Array<[string, string]> = [
          ['state', `${STATE()}/api/state`],
          ['join', `${JOIN()}/api/members`],
          ['core', `${CORE()}/health`],
          ['mirror', `${MIRROR()}/health`],
          ['events', `${EVENTS()}/health`],
        ];
        const up: string[] = [];
        const down: string[] = [];
        for (const [name, target] of probes) {
          const r = await getJson<unknown>(target, 1500);
          const port = new URL(target).port;
          if (r.ok || (r.error && !/not answering/.test(r.error))) up.push(`${name} ${port}`);
          else down.push(`${name} ${port}`);
        }
        lines.push(`doors  : ${up.join(' \u00B7 ') || 'none'}${down.length ? `  |  DOWN: ${down.join(' \u00B7 ')}` : ''}`);

        // 2. the nodes, one line each, from the assembled LAN view
        const lan = await getJson<any>(`${MIRROR()}/api/lan.json`, 6000);
        if (!lan.ok) {
          lines.push(`nodes  : unreadable — ${lan.error}`);
        } else {
          const nodes = lan.body.nodes ?? [];
          const absent = lan.body.declaredAbsent ?? [];
          lines.push(`nodes  : ${nodes.length} answering, ${absent.length} declared and absent`);
          for (const n of nodes) {
            const doors = n.doors ? `${n.doors.up}/${n.doors.count}` : '-';
            const st = n.standby;
            let doing = 'idle';
            if (st && st.mode) {
              doing = st.mode === 'mining'
                ? `mining ${st.algorithm ?? st.algo ?? ''} ${st.rate ?? ''}${st.accepted != null ? ` (${st.accepted} acc)` : ''}`.trim()
                : st.mode;
            } else if (n.services?.length) {
              doing = `${n.services.length} service(s)`;
            }
            const bits = [
              (n.ref ?? n.name ?? '?').padEnd(10),
              String(n.verdict ?? '?').padEnd(8),
              `doors ${doors}`.padEnd(11),
              (n.gpu ? String(n.gpu).slice(0, 22) : '').padEnd(23),
              doing,
            ];
            lines.push(`  ${bits.join(' ')}`);
          }
          if (absent.length) {
            lines.push(`  absent: ${absent.map((a: any) => `${a.name ?? a.ref}${a.why ? ` (${a.why})` : ''}`).join(', ')}`);
          }
        }

        // 2b. miners - Mirror only probes roster rows it can match to a peer, so a box with no Hydra shelf
        // (ReX: a miner and nothing else) is absent from the node table even while it earns. MinerState is the
        // door that resolved it, and its readings are the same numbers it publishes into State.
        const miners = await getJson<any>(`${MINERSTATE()}/state`, 4000);
        if (miners.ok && Array.isArray(miners.body?.nodes) && miners.body.nodes.length) {
          for (const m of miners.body.nodes) {
            const line = m.readable
              ? `miners : ${String(m.node).padEnd(6)} ${String(m.miner ?? '').padEnd(9)} ${String(m.algo ?? '').padEnd(12)} ${String(m.hashrate ?? '').padEnd(10)} acc ${m.accepted ?? '?'} rej ${m.rejected ?? '?'}  ${m.pool ?? ''} (via ${m.via ?? '?'})`
              : `miners : ${String(m.node).padEnd(6)} NOT READABLE - ${m.why ?? 'no miner answering'}`;
            lines.push(line);
          }
        } else if (!miners.ok) {
          lines.push(`miners : MinerState not answering (${miners.error})`);
        }

        // 3. what is next - the frontier, not a memory of it
        const brief = await getJson<{ count: number; text: string }>(`${TOT()}/api/brief?states=blocked,active,open&limit=5`);
        if (brief.ok) {
          lines.push(`next   : ${brief.body.count} open intention(s)`);
          lines.push(
            ...String(brief.body.text)
              .split('\n')
              .filter((l) => l.trim())
              .slice(0, 8)
              .map((l) => `  ${l.trim()}`),
          );
        } else {
          lines.push(`next   : unreadable — ${brief.error}`);
        }

        lines.push(
          'serve  : say which refs you are serving, and record it: node module/TrainOfThought/scripts/session-start.mjs --session <id> --take <refs>',
        );
        return say(lines.join('\n'));
      },
    },
  ];
}
