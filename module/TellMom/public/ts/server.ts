/**
 * @module server
 * @description The Tell Mom door: one verb, a policy, and a receipt for every tell.
 * @intent "Tell Mom" must not become "shout at Mom": a loop that fails every ten minutes should not ring the phone
 *         every ten minutes. So the policy lives here (dedupe window, hourly ceiling, quiet hours that alerts may
 *         cross) and every tell is recorded whether or not a transport took it. The receipt is the point: a message
 *         that reached nothing is a fact the operator can see, not a silence they discover later.
 *
 * Routes:
 *   GET  /health                      → liveness + which channels are configured
 *   GET  /api/channels               → channel state and exactly what each one is missing
 *   POST /api/tell {severity, subject, body, wants, dedupeKey, channels}
 *   GET  /api/told?limit=20          → the receipt ledger, newest last
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  appendTold,
  discordConfig,
  readEnvFile,
  sendDiscord,
  sendPane,
  type ChannelConfig,
  type ChannelResult,
} from './channels.js';

export interface SenderPolicy {
  /** Hard ceiling per hour FOR THIS SENDER. 0 means "may not tell at all" — a declared mute by name. */
  perHour?: number;
  /** If present, a severity outside this list is muted for that sender (a sender may warn but not page). */
  severities?: Severity[];
}

export interface Policy {
  /** A repeated dedupeKey inside this window is not sent again; it is reported as deduped. */
  dedupeWindowSec: number;
  /** Hard ceiling per hour, across all keys — the floor under every sender. */
  maxPerHour: number;
  /** Quiet hours, "HH:MM" local. A window crossing midnight is written like 22:00 -> 07:00. Alerts cross it. */
  quiet: { from: string; to: string } | null;
  /** Channels to try, in order. 'pane' is always added even when absent here. */
  channels: string[];
  /**
   * Declared senders and their ceilings. A name absent from this map falls back to maxPerHour; a name declared with
   * perHour 0 answers 403 and may not tell at all. This is what stops a runaway loop: the loop's module is declared,
   * and its declaration is the thing that throttles it.
   */
  senders: Record<string, SenderPolicy>;
  /**
   * Muted subjects. A tell whose subject starts with one of these (case-insensitive) is recorded and NOT sent; '*'
   * mutes everything. Alerts do NOT cross a mute — a mute is the operator's word, and the receipt still says so.
   */
  mutedSubjects: string[];
}

export const DEFAULT_POLICY: Policy = {
  dedupeWindowSec: 900,
  maxPerHour: 6,
  quiet: null,
  channels: ['discord', 'pane'],
  senders: {},
  mutedSubjects: [],
};

export interface ServerOptions {
  port: number;
  host: string;
  dataDir: string;
  stateUrl: string;
  /** The ref this node publishes under, e.g. "123". */
  nodeRef: string;
  channels: ChannelConfig;
  env: Record<string, string>;
}

export type Severity = 'info' | 'note' | 'warn' | 'alert';

export interface TellRecord {
  id: string;
  at: string;
  severity: Severity;
  subject: string;
  body: string;
  wants: string | null;
  dedupeKey: string | null;
  /** Who asked to tell. Defaults to 'hand' — a person or a script with no declaration. Never anonymous on the wire. */
  by?: string;
  delivered: ChannelResult[];
  /** Set when the policy refused to send it: the reason, so a caller can tell "not delivered" from "muted". */
  deduped?: string;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body, null, 2));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString('utf8');
      if (data.length > 200_000) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/** Load the policy, writing the defaults the first time so the operator can see and edit what governs them. */
export function loadPolicy(file: string): Policy {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Policy>;
    const senders: Record<string, SenderPolicy> = {};
    if (raw.senders && typeof raw.senders === 'object' && !Array.isArray(raw.senders)) {
      for (const [name, value] of Object.entries(raw.senders)) {
        const v = (value ?? {}) as SenderPolicy;
        senders[name] = {
          ...(typeof v.perHour === 'number' ? { perHour: v.perHour } : {}),
          ...(Array.isArray(v.severities) ? { severities: v.severities.filter((s) => ['info', 'note', 'warn', 'alert'].includes(String(s))) as Severity[] } : {}),
        };
      }
    }
    return {
      dedupeWindowSec: typeof raw.dedupeWindowSec === 'number' ? raw.dedupeWindowSec : DEFAULT_POLICY.dedupeWindowSec,
      maxPerHour: typeof raw.maxPerHour === 'number' ? raw.maxPerHour : DEFAULT_POLICY.maxPerHour,
      quiet: raw.quiet && typeof raw.quiet.from === 'string' && typeof raw.quiet.to === 'string' ? raw.quiet : null,
      channels: Array.isArray(raw.channels) && raw.channels.length ? raw.channels.map(String) : [...DEFAULT_POLICY.channels],
      senders,
      mutedSubjects: Array.isArray(raw.mutedSubjects) ? raw.mutedSubjects.map(String) : [],
    };
  } catch {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(DEFAULT_POLICY, null, 2));
    return { ...DEFAULT_POLICY, channels: [...DEFAULT_POLICY.channels], senders: {}, mutedSubjects: [] };
  }
}

/** Write the policy back (mute / unmute are operator actions, so they are persisted, not memory). */
export function savePolicy(file: string, policy: Policy): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(policy, null, 2));
}

/** "HH:MM" -> minutes. A bad string yields null rather than midnight, which would silence the wrong hours. */
function minutesOf(clock: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Is the local clock inside the quiet window? A window that crosses midnight is handled as two spans. */
export function inQuietHours(quiet: Policy['quiet'], now = new Date()): boolean {
  if (!quiet) return false;
  const from = minutesOf(quiet.from);
  const to = minutesOf(quiet.to);
  if (from === null || to === null || from === to) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  if (from < to) return cur >= from && cur < to;
  return cur >= from || cur < to;
}

export function createServer(options: ServerOptions): http.Server {
  const policyFile = path.join(options.dataDir, 'policy.json');
  const toldFile = path.join(options.dataDir, 'told.jsonl');
  /**
   * The policy is a FILE the operator edits, so caching it until restart would make an edit invisible — the same
   * failure as a store that loads once at boot. Stat it on every request (a few times a second is plenty) and reload
   * when it moves, so "I muted that subject" is true the moment the file changes.
   */
  let policy = loadPolicy(policyFile);
  let policyMtime = 0;
  try {
    policyMtime = fs.statSync(policyFile).mtimeMs;
  } catch {
    /* loadPolicy just wrote it */
  }
  const reloadPolicyIfChanged = (): void => {
    try {
      const mtime = fs.statSync(policyFile).mtimeMs;
      if (mtime !== policyMtime) {
        policy = loadPolicy(policyFile);
        policyMtime = mtime;
      }
    } catch {
      /* an unreadable policy keeps the last good one */
    }
  };
  /** In-memory list of recent tells, rebuilt from the file at boot: the receipt must survive a restart. */
  const recent: TellRecord[] = [];
  try {
    for (const line of fs.readFileSync(toldFile, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        recent.push(JSON.parse(line) as TellRecord);
      } catch {
        /* one bad line costs one receipt */
      }
    }
  } catch {
    /* no ledger yet */
  }

  const publish = async (record: TellRecord): Promise<void> => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      await fetch(`${options.stateUrl.replace(/\/$/, '')}/api/state/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: `node.${options.nodeRef}.told`,
          content: {
            at: record.at,
            severity: record.severity,
            subject: record.subject,
            by: record.by ?? 'hand',
            channels: record.delivered.map((d) => `${d.channel}:${d.ok ? 'ok' : 'fail'}`),
            deduped: record.deduped ?? null,
            reachedSomething: record.delivered.some((d) => d.ok),
            count1h: recent.filter((r) => Date.parse(r.at) > Date.now() - 3_600_000).length,
          },
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
    } catch {
      /* State being down does not undo a delivered message */
    }
  };

  const channelState = () => {
    const discord = discordConfig(options.env);
    return {
      pane: { ok: true, detail: `echidna at ${options.channels.paneUrl}` },
      discord: { ok: !discord.missing, detail: discord.missing ?? `posting to ${discord.channelId ?? `DM ${discord.dmUserId}`}` },
    };
  };

  return http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
      const method = (req.method ?? 'GET').toUpperCase();
      const p = url.pathname;
      // A hand edit to data/policy.json takes effect on the next request, not the next restart.
      reloadPolicyIfChanged();

      if (p === '/health') {
        sendJson(res, 200, {
          ok: true,
          door: 'tellmom',
          policy,
          channels: channelState(),
          tells: recent.length,
          senders: Object.keys(policy.senders).length,
          muted: policy.mutedSubjects.length,
        });
        return;
      }

      if (p === '/api/channels' && method === 'GET') {
        sendJson(res, 200, { channels: channelState() });
        return;
      }

      if (p === '/api/told' && method === 'GET') {
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 20) || 20));
        sendJson(res, 200, { tells: recent.slice(-limit) });
        return;
      }

      if (p === '/api/policy' && method === 'GET') {
        // The operator surface: what governs telling right now, who has been telling, and what is muted. A policy
        // that can only be read by opening a file is a policy nobody checks.
        const tallies = recent
          .filter((r) => !r.deduped && Date.now() - Date.parse(r.at) < 3_600_000)
          .reduce<Record<string, number>>((acc, r) => {
            const key = r.by ?? 'hand';
            acc[key] = (acc[key] ?? 0) + 1;
            return acc;
          }, {});
        sendJson(res, 200, { ok: true, policy, senders: policy.senders, mutedSubjects: policy.mutedSubjects, lastHourBy: tallies });
        return;
      }

      if ((p === '/api/mute' || p === '/api/unmute') && method === 'POST') {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        const subject = String(body.subject ?? '').trim();
        if (!subject) {
          sendJson(res, 400, { ok: false, error: "a subject is required - use \"*\" to mute everything" });
          return;
        }
        const on = p === '/api/mute';
        const present = policy.mutedSubjects.some((m) => m.toLowerCase() === subject.toLowerCase());
        if (on && !present) policy.mutedSubjects.push(subject);
        if (!on && present) policy.mutedSubjects = policy.mutedSubjects.filter((m) => m.toLowerCase() !== subject.toLowerCase());
        savePolicy(policyFile, policy);
        sendJson(res, 200, { ok: true, changed: on !== present, mutedSubjects: policy.mutedSubjects });
        return;
      }

      if (p === '/api/tell' && method === 'POST') {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
        } catch {
          sendJson(res, 400, { ok: false, error: 'body must be JSON' });
          return;
        }
        const subject = String(body.subject ?? '').trim();
        const text = String(body.body ?? '').trim();
        if (!subject && !text) {
          sendJson(res, 400, { ok: false, error: 'a subject or a body is required - an empty message is not a tell' });
          return;
        }
        const severity = (['info', 'note', 'warn', 'alert'].includes(String(body.severity)) ? String(body.severity) : 'note') as Severity;
        const dedupeKey = body.dedupeKey ? String(body.dedupeKey) : null;
        const now = Date.now();
        const by = body.by ? String(body.by) : 'hand';
        const record: TellRecord = {
          id: `tell-${now.toString(36)}-${Math.floor(Math.random() * 1296).toString(36)}`,
          at: new Date(now).toISOString(),
          severity,
          subject,
          body: text,
          wants: body.wants ? String(body.wants) : null,
          dedupeKey,
          by,
          delivered: [],
        };

        /**
         * Every refusal is a RECORD, not a silence: the line is appended, the memory list moves, the LAN row is
         * republished and the caller gets the reason. A muted tell that left no trace would be the one failure mode
         * this door exists to prevent.
         */
        const muted = (reason: string, status = 200): void => {
          record.deduped = reason;
          appendTold(toldFile, record);
          recent.push(record);
          while (recent.length > 500) recent.shift();
          void publish(record);
          sendJson(res, status, { ok: status === 200, deduped: reason, record });
        };

        // (1) THE SENDER IS DECLARED. A module declared with perHour 0 may not tell at all; one declared with a
        // severity list cannot page above it. The declaration is the throttle, so a runaway loop is a policy problem
        // with a name on it, not a phone that rings all night.
        const sender = policy.senders[by] ?? {};
        if (typeof sender.perHour === 'number' && sender.perHour <= 0) {
          // A refusal is still a receipt: the caller gets 403, the ledger and the LAN row say why.
          record.deduped = `sender '${by}' is declared with perHour 0 - this module may not tell`;
          appendTold(toldFile, record);
          recent.push(record);
          while (recent.length > 500) recent.shift();
          void publish(record);
          sendJson(res, 403, {
            ok: false,
            error: `sender '${by}' is declared with perHour 0 - this module may not tell. Edit data/policy.json senders.`,
            deduped: record.deduped,
            record,
          });
          return;
        }
        if (sender.severities && !sender.severities.includes(severity)) {
          muted(`sender '${by}' may only tell ${sender.severities.join('/')} - ${severity} is outside its declaration`);
          return;
        }

        // (2) THE SUBJECT IS MUTED — a key, not a switch on the module. 'Phoenix beat' silences that subject while
        // Phoenix is still free to tell 'disk full'. Alerts do not cross it: the operator's word outranks the severity.
        const muteKey = policy.mutedSubjects.find((m) => m === '*' || subject.toLowerCase().startsWith(m.toLowerCase()));
        if (muteKey) {
          muted(`subject muted by policy (${muteKey}) - the module is still free to tell other subjects`);
          return;
        }

        // (3) dedupe: the same key inside the window is muted, and says so
        if (dedupeKey) {
          const prior = recent.filter((r) => r.dedupeKey === dedupeKey && now - Date.parse(r.at) < policy.dedupeWindowSec * 1000);
          if (prior.length) {
            muted(`same dedupeKey told ${prior.length}x inside ${policy.dedupeWindowSec}s`);
            return;
          }
        }

        // (4) ceilings: the sender's own declaration first, then the door's floor. Measured on what was actually sent.
        const sentBySender = recent.filter((r) => !r.deduped && (r.by ?? 'hand') === by && now - Date.parse(r.at) < 3_600_000).length;
        const senderCeiling = typeof sender.perHour === 'number' ? sender.perHour : policy.maxPerHour;
        if (sentBySender >= senderCeiling) {
          muted(`sender '${by}' ceiling reached (${sentBySender}/${senderCeiling} this hour)`);
          return;
        }
        const lastHour = recent.filter((r) => !r.deduped && now - Date.parse(r.at) < 3_600_000).length;
        if (lastHour >= policy.maxPerHour) {
          muted(`hourly ceiling reached (${lastHour}/${policy.maxPerHour})`);
          return;
        }

        // (5) quiet hours — an alert crosses, nothing else does
        if (inQuietHours(policy.quiet) && severity !== 'alert') {
          muted('quiet hours');
          return;
        }

        const wanted = Array.isArray(body.channels) && body.channels.length ? body.channels.map(String) : policy.channels;
        const textForHumans = [subject ? `**${subject}**` : '', text, record.wants ? `wants: ${record.wants}` : '']
          .filter(Boolean)
          .join('\n');
        const prefix = severity === 'alert' ? '[ALERT] ' : severity === 'warn' ? '[warn] ' : '';

        for (const channel of wanted) {
          if (channel === 'discord') {
            record.delivered.push(await sendDiscord(discordConfig(options.env), `${prefix}${textForHumans}`));
          } else if (channel === 'pane') {
            record.delivered.push(await sendPane(options.channels.paneUrl, subject, text, severity));
          } else {
            record.delivered.push({ channel, ok: false, detail: 'no such channel on this node', ms: 0 });
          }
        }

        appendTold(toldFile, record);
        recent.push(record);
        while (recent.length > 500) recent.shift();
        await publish(record);
        const anyOk = record.delivered.some((d) => d.ok);
        sendJson(res, anyOk ? 200 : 502, { ok: anyOk, record });
        return;
      }

      sendJson(res, 404, { ok: false, error: 'no route', path: p });
    })().catch((error: Error) => {
      try {
        sendJson(res, 500, { ok: false, error: error.message });
      } catch {
        /* socket already gone */
      }
    });
  });
}

export { readEnvFile };
