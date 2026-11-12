import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  appendTold,
  discordConfig,
  readEnvFile,
  sendDiscord,
  sendPane
} from "./channels.js";
const DEFAULT_POLICY = {
  dedupeWindowSec: 900,
  maxPerHour: 6,
  quiet: null,
  channels: ["discord", "pane"],
  senders: {},
  mutedSubjects: []
};
function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body, null, 2));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk.toString("utf8");
      if (data.length > 2e5) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
function loadPolicy(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const senders = {};
    if (raw.senders && typeof raw.senders === "object" && !Array.isArray(raw.senders)) {
      for (const [name, value] of Object.entries(raw.senders)) {
        const v = value ?? {};
        senders[name] = {
          ...typeof v.perHour === "number" ? { perHour: v.perHour } : {},
          ...Array.isArray(v.severities) ? { severities: v.severities.filter((s) => ["info", "note", "warn", "alert"].includes(String(s))) } : {}
        };
      }
    }
    return {
      dedupeWindowSec: typeof raw.dedupeWindowSec === "number" ? raw.dedupeWindowSec : DEFAULT_POLICY.dedupeWindowSec,
      maxPerHour: typeof raw.maxPerHour === "number" ? raw.maxPerHour : DEFAULT_POLICY.maxPerHour,
      quiet: raw.quiet && typeof raw.quiet.from === "string" && typeof raw.quiet.to === "string" ? raw.quiet : null,
      channels: Array.isArray(raw.channels) && raw.channels.length ? raw.channels.map(String) : [...DEFAULT_POLICY.channels],
      senders,
      mutedSubjects: Array.isArray(raw.mutedSubjects) ? raw.mutedSubjects.map(String) : []
    };
  } catch {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(DEFAULT_POLICY, null, 2));
    return { ...DEFAULT_POLICY, channels: [...DEFAULT_POLICY.channels], senders: {}, mutedSubjects: [] };
  }
}
function savePolicy(file, policy) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(policy, null, 2));
}
function minutesOf(clock) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}
function inQuietHours(quiet, now = /* @__PURE__ */ new Date()) {
  if (!quiet) return false;
  const from = minutesOf(quiet.from);
  const to = minutesOf(quiet.to);
  if (from === null || to === null || from === to) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  if (from < to) return cur >= from && cur < to;
  return cur >= from || cur < to;
}
function createServer(options) {
  const policyFile = path.join(options.dataDir, "policy.json");
  const toldFile = path.join(options.dataDir, "told.jsonl");
  let policy = loadPolicy(policyFile);
  let policyMtime = 0;
  try {
    policyMtime = fs.statSync(policyFile).mtimeMs;
  } catch {
  }
  const reloadPolicyIfChanged = () => {
    try {
      const mtime = fs.statSync(policyFile).mtimeMs;
      if (mtime !== policyMtime) {
        policy = loadPolicy(policyFile);
        policyMtime = mtime;
      }
    } catch {
    }
  };
  const recent = [];
  try {
    for (const line of fs.readFileSync(toldFile, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        recent.push(JSON.parse(line));
      } catch {
      }
    }
  } catch {
  }
  const publish = async (record) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      await fetch(`${options.stateUrl.replace(/\/$/, "")}/api/state/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: `node.${options.nodeRef}.told`,
          content: {
            at: record.at,
            severity: record.severity,
            subject: record.subject,
            by: record.by ?? "hand",
            channels: record.delivered.map((d) => `${d.channel}:${d.ok ? "ok" : "fail"}`),
            deduped: record.deduped ?? null,
            reachedSomething: record.delivered.some((d) => d.ok),
            count1h: recent.filter((r) => Date.parse(r.at) > Date.now() - 36e5).length
          }
        }),
        signal: controller.signal
      });
      clearTimeout(timer);
    } catch {
    }
  };
  const channelState = () => {
    const discord = discordConfig(options.env);
    return {
      pane: { ok: true, detail: `echidna at ${options.channels.paneUrl}` },
      discord: { ok: !discord.missing, detail: discord.missing ?? `posting to ${discord.channelId ?? `DM ${discord.dmUserId}`}` }
    };
  };
  return http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
      const method = (req.method ?? "GET").toUpperCase();
      const p = url.pathname;
      reloadPolicyIfChanged();
      if (p === "/health") {
        sendJson(res, 200, {
          ok: true,
          door: "tellmom",
          policy,
          channels: channelState(),
          tells: recent.length,
          senders: Object.keys(policy.senders).length,
          muted: policy.mutedSubjects.length
        });
        return;
      }
      if (p === "/api/channels" && method === "GET") {
        sendJson(res, 200, { channels: channelState() });
        return;
      }
      if (p === "/api/told" && method === "GET") {
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 20) || 20));
        sendJson(res, 200, { tells: recent.slice(-limit) });
        return;
      }
      if (p === "/api/policy" && method === "GET") {
        const tallies = recent.filter((r) => !r.deduped && Date.now() - Date.parse(r.at) < 36e5).reduce((acc, r) => {
          const key = r.by ?? "hand";
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {});
        sendJson(res, 200, { ok: true, policy, senders: policy.senders, mutedSubjects: policy.mutedSubjects, lastHourBy: tallies });
        return;
      }
      if ((p === "/api/mute" || p === "/api/unmute") && method === "POST") {
        let body;
        try {
          body = JSON.parse(await readBody(req) || "{}");
        } catch {
          sendJson(res, 400, { ok: false, error: "body must be JSON" });
          return;
        }
        const subject = String(body.subject ?? "").trim();
        if (!subject) {
          sendJson(res, 400, { ok: false, error: 'a subject is required - use "*" to mute everything' });
          return;
        }
        const on = p === "/api/mute";
        const present = policy.mutedSubjects.some((m) => m.toLowerCase() === subject.toLowerCase());
        if (on && !present) policy.mutedSubjects.push(subject);
        if (!on && present) policy.mutedSubjects = policy.mutedSubjects.filter((m) => m.toLowerCase() !== subject.toLowerCase());
        savePolicy(policyFile, policy);
        sendJson(res, 200, { ok: true, changed: on !== present, mutedSubjects: policy.mutedSubjects });
        return;
      }
      if (p === "/api/tell" && method === "POST") {
        let body;
        try {
          body = JSON.parse(await readBody(req) || "{}");
        } catch {
          sendJson(res, 400, { ok: false, error: "body must be JSON" });
          return;
        }
        const subject = String(body.subject ?? "").trim();
        const text = String(body.body ?? "").trim();
        if (!subject && !text) {
          sendJson(res, 400, { ok: false, error: "a subject or a body is required - an empty message is not a tell" });
          return;
        }
        const severity = ["info", "note", "warn", "alert"].includes(String(body.severity)) ? String(body.severity) : "note";
        const dedupeKey = body.dedupeKey ? String(body.dedupeKey) : null;
        const now = Date.now();
        const by = body.by ? String(body.by) : "hand";
        const record = {
          id: `tell-${now.toString(36)}-${Math.floor(Math.random() * 1296).toString(36)}`,
          at: new Date(now).toISOString(),
          severity,
          subject,
          body: text,
          wants: body.wants ? String(body.wants) : null,
          dedupeKey,
          by,
          delivered: []
        };
        const muted = (reason, status = 200) => {
          record.deduped = reason;
          appendTold(toldFile, record);
          recent.push(record);
          while (recent.length > 500) recent.shift();
          void publish(record);
          sendJson(res, status, { ok: status === 200, deduped: reason, record });
        };
        const sender = policy.senders[by] ?? {};
        if (typeof sender.perHour === "number" && sender.perHour <= 0) {
          record.deduped = `sender '${by}' is declared with perHour 0 - this module may not tell`;
          appendTold(toldFile, record);
          recent.push(record);
          while (recent.length > 500) recent.shift();
          void publish(record);
          sendJson(res, 403, {
            ok: false,
            error: `sender '${by}' is declared with perHour 0 - this module may not tell. Edit data/policy.json senders.`,
            deduped: record.deduped,
            record
          });
          return;
        }
        if (sender.severities && !sender.severities.includes(severity)) {
          muted(`sender '${by}' may only tell ${sender.severities.join("/")} - ${severity} is outside its declaration`);
          return;
        }
        const muteKey = policy.mutedSubjects.find((m) => m === "*" || subject.toLowerCase().startsWith(m.toLowerCase()));
        if (muteKey) {
          muted(`subject muted by policy (${muteKey}) - the module is still free to tell other subjects`);
          return;
        }
        if (dedupeKey) {
          const prior = recent.filter((r) => r.dedupeKey === dedupeKey && now - Date.parse(r.at) < policy.dedupeWindowSec * 1e3);
          if (prior.length) {
            muted(`same dedupeKey told ${prior.length}x inside ${policy.dedupeWindowSec}s`);
            return;
          }
        }
        const sentBySender = recent.filter((r) => !r.deduped && (r.by ?? "hand") === by && now - Date.parse(r.at) < 36e5).length;
        const senderCeiling = typeof sender.perHour === "number" ? sender.perHour : policy.maxPerHour;
        if (sentBySender >= senderCeiling) {
          muted(`sender '${by}' ceiling reached (${sentBySender}/${senderCeiling} this hour)`);
          return;
        }
        const lastHour = recent.filter((r) => !r.deduped && now - Date.parse(r.at) < 36e5).length;
        if (lastHour >= policy.maxPerHour) {
          muted(`hourly ceiling reached (${lastHour}/${policy.maxPerHour})`);
          return;
        }
        if (inQuietHours(policy.quiet) && severity !== "alert") {
          muted("quiet hours");
          return;
        }
        const wanted = Array.isArray(body.channels) && body.channels.length ? body.channels.map(String) : policy.channels;
        const textForHumans = [subject ? `**${subject}**` : "", text, record.wants ? `wants: ${record.wants}` : ""].filter(Boolean).join("\n");
        const prefix = severity === "alert" ? "[ALERT] " : severity === "warn" ? "[warn] " : "";
        for (const channel of wanted) {
          if (channel === "discord") {
            record.delivered.push(await sendDiscord(discordConfig(options.env), `${prefix}${textForHumans}`));
          } else if (channel === "pane") {
            record.delivered.push(await sendPane(options.channels.paneUrl, subject, text, severity));
          } else {
            record.delivered.push({ channel, ok: false, detail: "no such channel on this node", ms: 0 });
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
      sendJson(res, 404, { ok: false, error: "no route", path: p });
    })().catch((error) => {
      try {
        sendJson(res, 500, { ok: false, error: error.message });
      } catch {
      }
    });
  });
}
export {
  DEFAULT_POLICY,
  createServer,
  inQuietHours,
  loadPolicy,
  readEnvFile,
  savePolicy
};
//# sourceMappingURL=server.js.map
