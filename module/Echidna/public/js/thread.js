import fs from "node:fs";
import path from "node:path";
class ThreadStore {
  file;
  constructor(dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, "thread.jsonl");
  }
  /** Every turn, oldest first. A broken line is skipped rather than killing the thread. */
  read(limit = 400) {
    if (!fs.existsSync(this.file)) return [];
    const out = [];
    for (const line of fs.readFileSync(this.file, "utf8").split("\n")) {
      const text = line.trim();
      if (!text) continue;
      try {
        const t = JSON.parse(text);
        if (t && typeof t.text === "string" && typeof t.at === "string") out.push(t);
      } catch {
      }
    }
    return out.slice(-limit);
  }
  append(turn) {
    fs.appendFileSync(this.file, `${JSON.stringify(turn)}
`, "utf8");
    return turn;
  }
  clear() {
    if (fs.existsSync(this.file)) fs.writeFileSync(this.file, "", "utf8");
  }
}
function turnId(prefix, now = Date.now()) {
  return `${prefix}-${now.toString(36)}-${Math.floor(Math.random() * 1296).toString(36).padStart(2, "0")}`;
}
export {
  ThreadStore,
  turnId
};
//# sourceMappingURL=thread.js.map
