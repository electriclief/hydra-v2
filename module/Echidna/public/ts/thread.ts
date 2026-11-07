/**
 * @module thread
 * @description The conversation, on disk: one JSONL file, appended, never rewritten.
 * @intent State is in-memory everywhere else in Hydra, which is right for facts that can be recomputed. A
 *         conversation cannot be recomputed, so it is a file. The operator closes the app between sessions and
 *         the thread has to still be there, in order, with the times it happened.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface Turn {
  id: string;
  at: string;
  /**
   * 'you' | 'echidna' | 'system' | 'note' — system carries refusals and failures (something went wrong), 'note' is a
   * message that arrived from another door (Tell Mom): nobody failed, something happened.
   */
  role: 'you' | 'echidna' | 'system' | 'note';
  text: string;
  /** How long the agent took, for echidna turns. */
  ms?: number;
  /** Which hermes session answered, when it said. */
  sessionId?: string | null;
  /** Set when the turn is a failure, so the pane can mark it instead of pretending it is an answer. */
  failed?: boolean;
}

export class ThreadStore {
  readonly file: string;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'thread.jsonl');
  }

  /** Every turn, oldest first. A broken line is skipped rather than killing the thread. */
  read(limit = 400): Turn[] {
    if (!fs.existsSync(this.file)) return [];
    const out: Turn[] = [];
    for (const line of fs.readFileSync(this.file, 'utf8').split('\n')) {
      const text = line.trim();
      if (!text) continue;
      try {
        const t = JSON.parse(text) as Turn;
        if (t && typeof t.text === 'string' && typeof t.at === 'string') out.push(t);
      } catch {
        /* one bad line is one missing turn, not a dead thread */
      }
    }
    return out.slice(-limit);
  }

  append(turn: Turn): Turn {
    fs.appendFileSync(this.file, `${JSON.stringify(turn)}\n`, 'utf8');
    return turn;
  }

  clear(): void {
    if (fs.existsSync(this.file)) fs.writeFileSync(this.file, '', 'utf8');
  }
}

/** A short, sortable id for one turn. */
export function turnId(prefix: string, now = Date.now()): string {
  return `${prefix}-${now.toString(36)}-${Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')}`;
}
