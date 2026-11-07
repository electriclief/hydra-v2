/**
 * @module channels
 * @description Where a Tell Mom message can actually arrive. Each channel is an adapter; the caller never learns
 *              which one answered.
 * @intent "Tell Mom" is one verb and a few transports. Discord is the phone channel because this rig already has a
 *         token for it - and it is OUTBOUND ONLY: one HTTPS POST per message, no gateway process, no websocket,
 *         nothing that has to stay running or reconnect. That was the overhead the operator gave up on. The pane is
 *         always a channel too, so a message nobody was looking at is still there when they look.
 *         There is deliberately NO Telegram adapter: the operator does not want Telegram at all.
 *         Discord is also the operator's free answer to ISP double NAT between brokers, so the INBOUND side (reading
 *         messages, node-to-node brokering) belongs to a broker module that owns the one connection - never a second
 *         listener opened here.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface ChannelResult {
  channel: string;
  ok: boolean;
  /** For a failure: what is missing or what the transport said. For a success: the message id, if one came back. */
  detail: string;
  ms: number;
}

export interface ChannelConfig {
  /** Where the Hermes .env lives (DISCORD_BOT_TOKEN and friends), if this node has one. */
  envFile: string;
  /** The Echidna door, the pane channel's destination. */
  paneUrl: string;
}

/**
 * Read `KEY=value` lines from a dotenv file without a dependency and without ever printing a value.
 * A malformed line is skipped: a broken .env is not a reason to lose every channel.
 */
export function readEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq <= 0) continue;
      const key = t.slice(0, eq).trim();
      let value = t.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
  } catch {
    /* no file is the same as no variables */
  }
  return out;
}

/** Prefer the real environment, then the Hermes .env: the process is explicit, the file is convenience. */
export function resolveEnv(config: ChannelConfig): Record<string, string> {
  const out: Record<string, string> = { ...readEnvFile(config.envFile) };
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

export interface DiscordConfig {
  token: string | null;
  /** A channel to post in, when one is declared. */
  channelId: string | null;
  /** Otherwise the operator's user id, so the message is a DM to the person, not a post in a room. */
  dmUserId: string | null;
  missing: string | null;
}

export function discordConfig(env: Record<string, string>): DiscordConfig {
  const token = (env.DISCORD_BOT_TOKEN || '').trim() || null;
  const channelId = (env.DISCORD_CHANNEL_ID || '').trim() || null;
  const firstAllowed =
    (env.DISCORD_ALLOWED_USERS || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)[0] || null;
  const dmUserId = (env.DISCORD_DM_USER_ID || '').trim() || firstAllowed;
  const missing = !token
    ? 'DISCORD_BOT_TOKEN is not set'
    : !channelId && !dmUserId
      ? 'DISCORD_CHANNEL_ID or DISCORD_ALLOWED_USERS is not set'
      : null;
  return { token, channelId, dmUserId, missing };
}

interface DiscordResponse {
  res: Response | null;
  body: Record<string, unknown>;
  error: string | null;
}

async function discordPost(token: string, route: string, payload: unknown, timeoutMs: number): Promise<DiscordResponse> {
  const auth = ['Bot', token].join(' ');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`https://discord.com/api/v10${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: auth },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { res, body, error: null };
  } catch (error) {
    return { res: null, body: {}, error: (error as Error).message };
  }
}

/**
 * Discord, one POST per message. A declared channel id wins; otherwise the bot opens a DM with the operator and
 * posts there. Neither path runs a listener: nothing has to stay connected between messages.
 */
export async function sendDiscord(config: DiscordConfig, text: string, timeoutMs = 15000): Promise<ChannelResult> {
  const started = Date.now();
  if (!config.token || (!config.channelId && !config.dmUserId)) {
    return { channel: 'discord', ok: false, detail: config.missing ?? 'not configured', ms: 0 };
  }

  const message = { content: text.slice(0, 1900), allowed_mentions: { parse: [] as string[] } };
  let channelId = config.channelId;

  if (!channelId && config.dmUserId) {
    const dm = await discordPost(config.token, '/users/@me/channels', { recipient_id: config.dmUserId }, timeoutMs);
    if (dm.error || !dm.res?.ok) {
      const why = dm.error ?? String(dm.body.message ?? `discord answered ${dm.res?.status}`);
      return { channel: 'discord', ok: false, detail: `could not open a DM: ${why}`, ms: Date.now() - started };
    }
    channelId = String(dm.body.id ?? '');
    if (!channelId) {
      return { channel: 'discord', ok: false, detail: 'discord returned no DM channel id', ms: Date.now() - started };
    }
  }

  const sent = await discordPost(config.token, `/channels/${channelId}/messages`, message, timeoutMs);
  if (sent.error || !sent.res?.ok) {
    return {
      channel: 'discord',
      ok: false,
      detail: sent.error ?? String(sent.body.message ?? `discord answered ${sent.res?.status}`),
      ms: Date.now() - started,
    };
  }
  return { channel: 'discord', ok: true, detail: `message ${String(sent.body.id ?? '?')}`, ms: Date.now() - started };
}

/**
 * The pane channel: the message becomes a system turn in Echidna's thread, so a notification that nobody was
 * looking at is still there when they look. If the door is down the tell fails like any other channel.
 */
export async function sendPane(paneUrl: string, subject: string, body: string, severity: string, timeoutMs = 8000): Promise<ChannelResult> {
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${paneUrl.replace(/\/$/, '')}/api/note`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: 'Tell Mom', subject, text: body, severity }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { channel: 'pane', ok: false, detail: `echidna answered ${res.status}`, ms: Date.now() - started };
    return { channel: 'pane', ok: true, detail: 'in the thread', ms: Date.now() - started };
  } catch (error) {
    return { channel: 'pane', ok: false, detail: (error as Error).message, ms: Date.now() - started };
  }
}

/** The always-available channel: a file. A tell that reached no transport still reached the record. */
export function appendTold(file: string, record: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
}
