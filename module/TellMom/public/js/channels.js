import fs from "node:fs";
import path from "node:path";
function readEnvFile(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq <= 0) continue;
      const key = t.slice(0, eq).trim();
      let value = t.slice(eq + 1).trim();
      if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
  } catch {
  }
  return out;
}
function resolveEnv(config) {
  const out = { ...readEnvFile(config.envFile) };
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}
function discordConfig(env) {
  const token = (env.DISCORD_BOT_TOKEN || "").trim() || null;
  const channelId = (env.DISCORD_CHANNEL_ID || "").trim() || null;
  const firstAllowed = (env.DISCORD_ALLOWED_USERS || "").split(",").map((x) => x.trim()).filter(Boolean)[0] || null;
  const dmUserId = (env.DISCORD_DM_USER_ID || "").trim() || firstAllowed;
  const missing = !token ? "DISCORD_BOT_TOKEN is not set" : !channelId && !dmUserId ? "DISCORD_CHANNEL_ID or DISCORD_ALLOWED_USERS is not set" : null;
  return { token, channelId, dmUserId, missing };
}
async function discordPost(token, route, payload, timeoutMs) {
  const auth = ["Bot", token].join(" ");
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`https://discord.com/api/v10${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timer);
    const body = await res.json().catch(() => ({}));
    return { res, body, error: null };
  } catch (error) {
    return { res: null, body: {}, error: error.message };
  }
}
async function sendDiscord(config, text, timeoutMs = 15e3) {
  const started = Date.now();
  if (!config.token || !config.channelId && !config.dmUserId) {
    return { channel: "discord", ok: false, detail: config.missing ?? "not configured", ms: 0 };
  }
  const message = { content: text.slice(0, 1900), allowed_mentions: { parse: [] } };
  let channelId = config.channelId;
  if (!channelId && config.dmUserId) {
    const dm = await discordPost(config.token, "/users/@me/channels", { recipient_id: config.dmUserId }, timeoutMs);
    if (dm.error || !dm.res?.ok) {
      const why = dm.error ?? String(dm.body.message ?? `discord answered ${dm.res?.status}`);
      return { channel: "discord", ok: false, detail: `could not open a DM: ${why}`, ms: Date.now() - started };
    }
    channelId = String(dm.body.id ?? "");
    if (!channelId) {
      return { channel: "discord", ok: false, detail: "discord returned no DM channel id", ms: Date.now() - started };
    }
  }
  const sent = await discordPost(config.token, `/channels/${channelId}/messages`, message, timeoutMs);
  if (sent.error || !sent.res?.ok) {
    return {
      channel: "discord",
      ok: false,
      detail: sent.error ?? String(sent.body.message ?? `discord answered ${sent.res?.status}`),
      ms: Date.now() - started
    };
  }
  return { channel: "discord", ok: true, detail: `message ${String(sent.body.id ?? "?")}`, ms: Date.now() - started };
}
async function sendPane(paneUrl, subject, body, severity, timeoutMs = 8e3) {
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${paneUrl.replace(/\/$/, "")}/api/note`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: "Tell Mom", subject, text: body, severity }),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) return { channel: "pane", ok: false, detail: `echidna answered ${res.status}`, ms: Date.now() - started };
    return { channel: "pane", ok: true, detail: "in the thread", ms: Date.now() - started };
  } catch (error) {
    return { channel: "pane", ok: false, detail: error.message, ms: Date.now() - started };
  }
}
function appendTold(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}
`, "utf8");
}
export {
  appendTold,
  discordConfig,
  readEnvFile,
  resolveEnv,
  sendDiscord,
  sendPane
};
//# sourceMappingURL=channels.js.map
