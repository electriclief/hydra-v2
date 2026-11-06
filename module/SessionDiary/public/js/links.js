import fs from "node:fs";
import path from "node:path";
function linksFile(dataDir) {
  return path.join(dataDir, "session-links.jsonl");
}
function readLinks(dataDir) {
  try {
    return fs.readFileSync(linksFile(dataDir), "utf8").split(/\r?\n/).filter((line) => line.trim().length > 0).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter((row) => Boolean(row && row.sessionId && Array.isArray(row.refs)));
  } catch {
    return [];
  }
}
function servingFor(links, sessionId) {
  const out = [];
  for (const link of links) {
    if (link.sessionId !== sessionId) continue;
    for (const ref of link.refs) if (!out.includes(ref)) out.push(ref);
  }
  return out;
}
function servingMap(links) {
  const map = /* @__PURE__ */ new Map();
  for (const link of links) {
    const cur = map.get(link.sessionId) ?? [];
    for (const ref of link.refs) if (!cur.includes(ref)) cur.push(ref);
    map.set(link.sessionId, cur);
  }
  return map;
}
export {
  linksFile,
  readLinks,
  servingFor,
  servingMap
};
//# sourceMappingURL=links.js.map
