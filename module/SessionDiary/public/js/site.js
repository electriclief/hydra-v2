import fs from "node:fs";
import path from "node:path";
import { SessionStore } from "./store.js";
import { buildCard } from "./card.js";
import {
  ASSET_CSS,
  ASSET_JS,
  CSS,
  JS,
  PAGE_INDEX,
  renderIndex,
  renderSession,
  sessionFileName,
  toIndexRow
} from "./render.js";
class DiaryStore {
  file;
  data;
  constructor(file) {
    this.file = file;
    this.data = { diaries: {}, seances: [], spawns: [] };
    this.load();
  }
  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      this.data = {
        diaries: raw.diaries ?? {},
        seances: Array.isArray(raw.seances) ? raw.seances : [],
        spawns: Array.isArray(raw.spawns) ? raw.spawns : []
      };
    } catch {
      this.data = { diaries: {}, seances: [], spawns: [] };
    }
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
  diary(id) {
    return this.data.diaries[id];
  }
  setDiary(id, diary) {
    this.data.diaries[id] = diary;
    this.save();
  }
  seancesFor(id) {
    return this.data.seances.filter((seance) => seance.sessionId === id);
  }
  addSeance(seance) {
    this.data.seances.push(seance);
    if (seance.spawnSessionId) this.data.spawns.push(seance.spawnSessionId);
    this.save();
  }
}
class Site {
  options;
  data;
  constructor(options) {
    this.options = options;
    this.data = new DiaryStore(path.join(options.dataDir, "diaries.json"));
  }
  /** Bytes already written by this process, keyed by site-relative name. */
  written = /* @__PURE__ */ new Map();
  /**
   * Write one site file, skipping it when this process already wrote these exact bytes.
   * The site is ~460 files / 17 MB: a scan loop that rewrites all of them every minute is
   * pure disk churn, and the session pages only change when that session does.
   */
  write(name, content) {
    const bytes = Buffer.byteLength(content);
    if (this.written.get(name) === content) return bytes;
    const target = path.join(this.options.siteDir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    this.written.set(name, content);
    return bytes;
  }
  /** Build every page. One read of the store, then pure string work. */
  build() {
    const started = Date.now();
    fs.mkdirSync(this.options.siteDir, { recursive: true });
    this.write(ASSET_CSS, CSS);
    this.write(ASSET_JS, JS);
    const store = new SessionStore({ dbPath: this.options.dbPath, readOnly: true });
    let cards = [];
    try {
      const sessions = store.listSessions();
      const messages = store.messagesBySession();
      cards = sessions.map((session) => buildCard(session, messages.get(session.id) ?? []));
    } finally {
      store.close();
    }
    const byRef = /* @__PURE__ */ new Map();
    for (const card of cards) {
      const list = byRef.get(card.ref) ?? [];
      list.push(card.id);
      byRef.set(card.ref, list);
    }
    let collisions = 0;
    for (const card of cards) {
      const list = byRef.get(card.ref) ?? [];
      if (list.length > 1) {
        collisions += 1;
        const body = card.id.replace(/^[a-z]+-/, "");
        card.ref = body.length >= 10 ? body.slice(0, 10) : card.ref;
      }
    }
    const allRefs = new Map(cards.map((card) => [card.id, card.ref]));
    const rows = [];
    let pages = 0;
    let withDiary = 0;
    for (const card of cards) {
      const diary = this.data.diary(card.id);
      const seances = this.data.seancesFor(card.id);
      if (diary) withDiary += 1;
      rows.push(toIndexRow(card, diary, seances));
      const pageStamp = card.lastActivityAt ? card.lastActivityAt * 1e3 : card.startedAt ? card.startedAt * 1e3 : Date.now();
      this.write(
        sessionFileName(card.ref),
        renderSession({ card, diary, seances, apiBase: this.options.apiBase, generatedAt: pageStamp, allRefs })
      );
      pages += 1;
      const { turns: _turns, ...lean } = card;
      void _turns;
      this.write(
        path.join("data", "sessions", `${card.ref}.json`),
        JSON.stringify({ ...lean, diary: diary ?? null, seances }, null, 2)
      );
    }
    const stats = {
      sessions: cards.length,
      messages: cards.reduce((sum, card) => sum + (card.messageCount || card.turns.length), 0),
      tokens: cards.reduce((sum, card) => sum + card.inputTokens + card.outputTokens, 0),
      costUsd: cards.reduce((sum, card) => sum + (card.costUsd ?? 0), 0),
      firstAt: cards.reduce((min, card) => card.startedAt && (min === null || card.startedAt < min) ? card.startedAt : min, null),
      lastAt: cards.reduce((max, card) => card.startedAt && (max === null || card.startedAt > max) ? card.startedAt : max, null)
    };
    const indexHtml = renderIndex({
      rows,
      stats,
      generatedAt: Date.now(),
      dbPath: this.options.dbPath,
      apiBase: this.options.apiBase
    });
    const indexBytes = this.write(PAGE_INDEX, indexHtml);
    this.write(
      path.join("data", "index.json"),
      JSON.stringify({ generatedAt: Date.now(), stats, count: rows.length, rows }, null, 2)
    );
    const report = {
      at: Date.now(),
      ms: Date.now() - started,
      sessions: cards.length,
      pages,
      withDiary,
      seances: this.data.data.seances.length,
      indexBytes,
      refCollisions: collisions
    };
    this.write(path.join("data", "build.json"), JSON.stringify(report, null, 2));
    return report;
  }
  /** Rebuild one session's page after its diary or a seance changed — and its row in the index. */
  rebuildOne(id) {
    const store = new SessionStore({ dbPath: this.options.dbPath, readOnly: true });
    try {
      const session = store.session(id);
      if (!session) return false;
      const card = buildCard(session, store.messages(id));
      const others = store.listSessions();
      const allRefs = new Map(others.map((other) => [other.id, SessionStore.refFor(other.id)]));
      const diary = this.data.diary(id);
      const seances = this.data.seancesFor(id);
      this.write(
        sessionFileName(card.ref),
        renderSession({
          card,
          diary,
          seances,
          apiBase: this.options.apiBase,
          generatedAt: Date.now(),
          allRefs
        })
      );
      this.refreshIndexRow(toIndexRow(card, diary, seances));
      return true;
    } finally {
      store.close();
    }
  }
  /**
   * Patch one row in the built index instead of re-deriving 449 cards: the badge has to be right
   * the moment the diary lands, or the index lies until the next full scan.
   */
  refreshIndexRow(row) {
    const indexFile = path.join(this.options.siteDir, "data", "index.json");
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(indexFile, "utf8"));
    } catch {
      return;
    }
    const rows = parsed.rows ?? [];
    const at = rows.findIndex((existing) => existing.id === row.id);
    if (at === -1) return;
    rows[at] = row;
    this.write(path.join("data", "index.json"), JSON.stringify({ ...parsed, count: rows.length, rows }, null, 2));
    const stats = parsed.stats ?? {
      sessions: rows.length,
      messages: 0,
      tokens: 0,
      costUsd: 0,
      firstAt: null,
      lastAt: null
    };
    this.write(
      PAGE_INDEX,
      renderIndex({
        rows,
        stats,
        generatedAt: Date.now(),
        dbPath: this.options.dbPath,
        apiBase: this.options.apiBase
      })
    );
  }
  indexFile() {
    return path.join(this.options.siteDir, PAGE_INDEX);
  }
}
export {
  DiaryStore,
  Site
};
//# sourceMappingURL=site.js.map
