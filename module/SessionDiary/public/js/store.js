import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
const HEX = "0123456789abcdef";
function asRecord(row) {
  return row ?? {};
}
function str(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function toSessionRecord(row) {
  const r = asRecord(row);
  return {
    id: String(r.id ?? ""),
    title: str(r.title),
    source: String(r.source ?? "unknown"),
    model: str(r.model),
    parentId: str(r.parent_session_id),
    startedAt: num(r.started_at),
    endedAt: num(r.ended_at),
    endReason: str(r.end_reason),
    messageCount: num(r.message_count) ?? 0,
    toolCallCount: num(r.tool_call_count) ?? 0,
    inputTokens: num(r.input_tokens) ?? 0,
    outputTokens: num(r.output_tokens) ?? 0,
    costUsd: num(r.estimated_cost_usd) ?? num(r.actual_cost_usd),
    cwd: str(r.cwd),
    gitBranch: str(r.git_branch),
    gitRepo: str(r.git_repo_root),
    pinned: Number(r.pinned ?? 0) === 1,
    archived: Number(r.archived ?? 0) === 1,
    hidden: Number(r.hidden ?? 0) === 1,
    profileName: str(r.profile_name),
    lastActivityAt: num(r.last_activity_at),
    createdSource: str(r.created_source)
  };
}
function toMessageRecord(row) {
  const r = asRecord(row);
  return {
    id: Number(r.id ?? 0),
    sessionId: String(r.session_id ?? ""),
    role: String(r.role ?? "other"),
    content: String(r.content ?? ""),
    toolName: str(r.tool_name),
    toolCalls: str(r.tool_calls),
    timestamp: num(r.timestamp),
    active: num(r.active),
    compacted: num(r.compacted)
  };
}
class SessionStore {
  dbPath;
  readOnly;
  db;
  constructor(options) {
    this.dbPath = options.dbPath;
    this.readOnly = options.readOnly !== false;
    if (!fs.existsSync(this.dbPath)) throw new Error(`no session store at ${this.dbPath}`);
    this.db = new DatabaseSync(this.dbPath, { readOnly: this.readOnly });
    if (!this.readOnly) {
      try {
        this.db.exec("PRAGMA busy_timeout=8000");
      } catch {
      }
    }
  }
  close() {
    try {
      this.db.close();
    } catch {
    }
  }
  /** Every session, newest first. No filtering — the site decides what to show. */
  listSessions() {
    const rows = this.db.prepare(
      `SELECT id, title, source, model, parent_session_id, started_at, ended_at, end_reason,
                message_count, tool_call_count, input_tokens, output_tokens, estimated_cost_usd,
                actual_cost_usd, cwd, git_branch, git_repo_root, pinned, archived, hidden,
                profile_name, last_activity_at, created_source
           FROM sessions
          ORDER BY COALESCE(started_at, 0) DESC`
    ).all();
    return rows.map((row) => toSessionRecord(row));
  }
  session(id) {
    const row = this.db.prepare(
      `SELECT id, title, source, model, parent_session_id, started_at, ended_at, end_reason,
                message_count, tool_call_count, input_tokens, output_tokens, estimated_cost_usd,
                actual_cost_usd, cwd, git_branch, git_repo_root, pinned, archived, hidden,
                profile_name, last_activity_at, created_source
           FROM sessions WHERE id = ?`
    ).get(id);
    return row ? toSessionRecord(row) : null;
  }
  /** Live sessions whose id contains a substring — how a dead session is found by name. */
  findIds(needle, limit = 10) {
    const rows = this.db.prepare(`SELECT id FROM sessions WHERE title LIKE ? OR id LIKE ? ORDER BY started_at DESC LIMIT ?`).all(`%${needle}%`, `%${needle}%`, limit);
    return rows.map((row) => String(row.id));
  }
  /** Every visible message, grouped. One query for the whole store — 12k rows is nothing. */
  messagesBySession() {
    const rows = this.db.prepare(
      `SELECT id, session_id, role, content, tool_name, tool_calls, timestamp, active, compacted
           FROM messages
          WHERE (active = 1 OR active IS NULL)
          ORDER BY session_id, id`
    ).all();
    const grouped = /* @__PURE__ */ new Map();
    for (const row of rows) {
      const message = toMessageRecord(row);
      const list = grouped.get(message.sessionId);
      if (list) list.push(message);
      else grouped.set(message.sessionId, [message]);
    }
    return grouped;
  }
  messages(id) {
    const rows = this.db.prepare(
      `SELECT id, session_id, role, content, tool_name, tool_calls, timestamp, active, compacted
           FROM messages
          WHERE session_id = ? AND (active = 1 OR active IS NULL)
          ORDER BY id`
    ).all(id);
    return rows.map((row) => toMessageRecord(row));
  }
  totals() {
    const s = this.db.prepare("SELECT COUNT(*) AS c FROM sessions").get();
    const m = this.db.prepare("SELECT COUNT(*) AS c FROM messages").get();
    return { sessions: Number(asRecord(s).c ?? 0), messages: Number(asRecord(m).c ?? 0) };
  }
  // ---------------------------------------------------------------- writes
  /** A physical copy of the live store, sibling of the db. Returns null if one was taken <1h ago. */
  backup(dir, maxAgeMs = 60 * 60 * 1e3) {
    fs.mkdirSync(dir, { recursive: true });
    const existing = fs.readdirSync(dir).filter((name) => name.startsWith("state-") && name.endsWith(".db")).map((name) => path.join(dir, name)).sort().reverse();
    if (existing.length > 0) {
      const age = Date.now() - fs.statSync(existing[0]).mtimeMs;
      if (age < maxAgeMs) return existing[0];
    }
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const target = path.join(dir, `state-${stamp}.db`);
    if (fs.existsSync(target)) fs.unlinkSync(target);
    this.db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    return target;
  }
  uniqueTitle(base) {
    const clean = (base || "session").slice(0, 90);
    const candidates = [`${clean} (fork)`, ...Array.from({ length: 40 }, (_, i) => `${clean} (fork ${i + 2})`)];
    for (const candidate of candidates) {
      const hit = this.db.prepare("SELECT 1 AS x FROM sessions WHERE title = ?").get(candidate);
      if (!hit) return candidate;
    }
    return `${clean} (fork ${Date.now()})`;
  }
  mintId() {
    const digest = createHash("sha256").update(randomBytes(32)).update(String(Date.now())).digest("hex");
    return `local-${digest}`;
  }
  /**
   * Fork: exact /branch semantics, done against the DB instead of a live session.
   * New row carrying the parent's identity, then the parent's visible transcript copied in,
   * then everything read back and compared. A failed check rolls the whole thing back.
   */
  fork(id, options = {}) {
    if (this.readOnly) throw new Error("fork needs a read-write store");
    const parentRow = asRecord(this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id));
    if (!parentRow.id) throw new Error(`no session ${id}`);
    const backup = options.backupDir ? this.backup(options.backupDir) : null;
    const checks = [];
    const columns = this.db.prepare("PRAGMA table_info(sessions)").all().map((row) => String(asRecord(row).name));
    const nowSec = Date.now() / 1e3;
    const newId = this.mintId();
    const title = options.title?.trim() || this.uniqueTitle(String(parentRow.title ?? "session"));
    let modelConfig = parentRow.model_config;
    try {
      if (typeof modelConfig === "string" && modelConfig.trim().startsWith("{")) {
        const parsed = JSON.parse(modelConfig);
        parsed._branched_from = id;
        parsed._branched_by = "sessiondiary";
        modelConfig = JSON.stringify(parsed);
      } else {
        modelConfig = JSON.stringify({ _branched_from: id, _branched_by: "sessiondiary" });
      }
    } catch {
      modelConfig = JSON.stringify({ _branched_from: id, _branched_by: "sessiondiary" });
    }
    const overrides = {
      id: newId,
      title,
      parent_session_id: id,
      started_at: nowSec,
      ended_at: null,
      end_reason: null,
      message_count: 0,
      tool_call_count: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      reasoning_tokens: 0,
      estimated_cost_usd: 0,
      actual_cost_usd: null,
      cost_status: "estimated",
      api_call_count: 0,
      archived: 0,
      pinned: 0,
      hidden: 0,
      auto_archived: 0,
      rewind_count: 0,
      session_key: null,
      chat_id: null,
      display_name: null,
      expiry_finalized: 0,
      handoff_state: null,
      handoff_platform: null,
      handoff_error: null,
      compression_failure_error: null,
      compression_failure_cooldown_until: null,
      compression_fallback_streak: 0,
      compression_ineffective_count: 0,
      last_activity_at: nowSec,
      last_activity_description: "forked from session diary",
      transcript_revision: 0,
      system_prompt: parentRow.system_prompt ?? null,
      model_config: modelConfig,
      title_source: "manual",
      created_source: "sessiondiary"
    };
    const insertColumns = columns.filter((name) => name !== "id");
    const placeholders = insertColumns.map(() => "?").join(", ");
    const values = insertColumns.map(
      (name) => Object.prototype.hasOwnProperty.call(overrides, name) ? overrides[name] : parentRow[name] ?? null
    );
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`INSERT INTO sessions (id, ${insertColumns.join(", ")}) VALUES (?, ${placeholders})`).run(newId, ...values);
      checks.push("session row written");
      const copied = this.db.prepare(
        `INSERT INTO messages (session_id, role, content, tool_call_id, tool_calls, tool_name,
                                 timestamp, token_count, finish_reason, reasoning, api_content,
                                 display_kind, active, compacted, _compressed_summary)
           SELECT ?, role, content, tool_call_id, tool_calls, tool_name,
                  timestamp, token_count, finish_reason, reasoning, api_content,
                  display_kind, active, compacted, _compressed_summary
             FROM messages
            WHERE session_id = ? AND (active = 1 OR active IS NULL)
            ORDER BY id`
      ).run(newId, id);
      const copiedRows = Number(copied.changes ?? 0);
      const stats = asRecord(
        this.db.prepare(
          `SELECT COUNT(*) AS c,
                    SUM(CASE WHEN role = 'assistant' AND tool_calls IS NOT NULL THEN 1 ELSE 0 END) AS t
               FROM messages WHERE session_id = ?`
        ).get(newId)
      );
      this.db.prepare("UPDATE sessions SET message_count = ?, tool_call_count = ? WHERE id = ?").run(Number(stats.c ?? 0), Number(stats.t ?? 0), newId);
      const parentHead = asRecord(
        this.db.prepare(
          `SELECT content FROM messages WHERE session_id = ? AND (active = 1 OR active IS NULL) ORDER BY id LIMIT 1`
        ).get(id)
      );
      const childHead = asRecord(
        this.db.prepare(
          `SELECT content FROM messages WHERE session_id = ? AND (active = 1 OR active IS NULL) ORDER BY id LIMIT 1`
        ).get(newId)
      );
      const parentTail = asRecord(
        this.db.prepare(
          `SELECT content FROM messages WHERE session_id = ? AND (active = 1 OR active IS NULL) ORDER BY id DESC LIMIT 1`
        ).get(id)
      );
      const childTail = asRecord(
        this.db.prepare(
          `SELECT content FROM messages WHERE session_id = ? AND (active = 1 OR active IS NULL) ORDER BY id DESC LIMIT 1`
        ).get(newId)
      );
      const parentCount = Number(
        asRecord(
          this.db.prepare(
            `SELECT COUNT(*) AS c FROM messages WHERE session_id = ? AND (active = 1 OR active IS NULL)`
          ).get(id)
        ).c ?? 0
      );
      if (copiedRows !== parentCount) throw new Error(`copied ${copiedRows} of ${parentCount} messages`);
      if (String(childHead.content ?? "") !== String(parentHead.content ?? "")) {
        throw new Error("first message differs from the parent");
      }
      if (String(childTail.content ?? "") !== String(parentTail.content ?? "")) {
        throw new Error("last message differs from the parent");
      }
      checks.push(`${copiedRows} messages copied, head and tail match`);
      const child = asRecord(this.db.prepare("SELECT parent_session_id, title FROM sessions WHERE id = ?").get(newId));
      if (child.parent_session_id !== id) throw new Error("child row lost its parent link");
      if (!child.title) throw new Error("child row has no title");
      checks.push(`row link + title ok (${child.title})`);
      this.db.exec("COMMIT");
      return { newId, title, messages: copiedRows, backup, verified: true, checks };
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
      }
      throw error;
    }
  }
  setTitle(id, title) {
    if (this.readOnly) throw new Error("setTitle needs a read-write store");
    this.db.prepare("UPDATE sessions SET title = ?, title_source = ? WHERE id = ?").run(title, "manual", id);
  }
  /** Hex helper kept here so refs are minted the same way everywhere. */
  static refFor(id) {
    const body = id.replace(/^[a-z]+-/, "");
    if (/^[0-9a-f]{6,}$/i.test(body)) return body.slice(0, 8);
    const digest = createHash("sha1").update(id).digest("hex");
    return digest.slice(0, 8);
  }
  static isHex(value) {
    for (const char of value) if (!HEX.includes(char)) return false;
    return value.length > 0;
  }
}
export {
  SessionStore,
  toSessionRecord
};
//# sourceMappingURL=store.js.map
