/**
 * Session -> train-of-thought links.
 *
 * A session announces which intention it is serving at its start (see
 * TrainOfThought/scripts/session-start.mjs), which appends one line here. This module only READS that file:
 * the diary never invents a link, and a missing file simply means no session has announced anything yet.
 *
 * The file is plain JSONL so it can be appended by a shell script with every door down, and read back by hand.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface SessionLink {
  at: string;
  sessionId: string;
  refs: string[];
  note?: string;
}

export function linksFile(dataDir: string): string {
  return path.join(dataDir, 'session-links.jsonl');
}

export function readLinks(dataDir: string): SessionLink[] {
  try {
    return fs
      .readFileSync(linksFile(dataDir), 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          return JSON.parse(line) as SessionLink;
        } catch {
          return null;
        }
      })
      .filter((row): row is SessionLink => Boolean(row && row.sessionId && Array.isArray(row.refs)));
  } catch {
    return [];
  }
}

/** Every ref this session announced, newest last, without duplicates. */
export function servingFor(links: SessionLink[], sessionId: string): string[] {
  const out: string[] = [];
  for (const link of links) {
    if (link.sessionId !== sessionId) continue;
    for (const ref of link.refs) if (!out.includes(ref)) out.push(ref);
  }
  return out;
}

/** Map of sessionId -> refs, for attaching to a list of rows in one pass. */
export function servingMap(links: SessionLink[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const link of links) {
    const cur = map.get(link.sessionId) ?? [];
    for (const ref of link.refs) if (!cur.includes(ref)) cur.push(ref);
    map.set(link.sessionId, cur);
  }
  return map;
}
