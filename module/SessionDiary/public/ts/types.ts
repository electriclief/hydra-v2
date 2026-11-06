/**
 * @module types
 * @description The vocabulary of the diary: a session row, a message row, the card the diary is
 *              built from, and the two records the module owns (diary prose, seances).
 */

export interface SessionRecord {
  id: string;
  title: string | null;
  source: string;
  model: string | null;
  parentId: string | null;
  startedAt: number | null;
  endedAt: number | null;
  endReason: string | null;
  messageCount: number;
  toolCallCount: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  cwd: string | null;
  gitBranch: string | null;
  gitRepo: string | null;
  pinned: boolean;
  archived: boolean;
  hidden: boolean;
  profileName: string | null;
  lastActivityAt: number | null;
  createdSource: string | null;
}

export interface MessageRecord {
  id: number;
  sessionId: string;
  role: string;
  content: string;
  toolName: string | null;
  toolCalls: string | null;
  timestamp: number | null;
  active: number | null;
  compacted: number | null;
}

export interface Call {
  name: string;
  brief: string;
}

export interface Turn {
  role: 'user' | 'assistant' | 'tool' | 'other';
  at: number | null;
  text: string;
  toolName?: string;
  calls?: Call[];
  truncated?: boolean;
}

export interface ToolCount {
  name: string;
  count: number;
}

/** Everything the site knows about one session, derived deterministically from the store. */
export interface Card extends SessionRecord {
  ref: string;
  displayTitle: string;
  durationSec: number | null;
  userTurns: number;
  goal: string;
  outcome: string;
  files: string[];
  commands: string[];
  tools: ToolCount[];
  turns: Turn[];
  bytes: number;
}

/** The compact row the index page carries for every session. */
export interface IndexRow {
  id: string;
  ref: string;
  title: string;
  source: string;
  model: string | null;
  startedAt: number | null;
  durationSec: number | null;
  messages: number;
  toolCalls: number;
  userTurns: number;
  costUsd: number | null;
  tokens: number;
  goal: string;
  files: number;
  tools: string[];
  parentId: string | null;
  pinned: boolean;
  archived: boolean;
  hasDiary: boolean;
  hasSeance: boolean;
}

export interface Diary {
  text: string;
  model: string;
  at: number;
  ms: number;
}

export interface Seance {
  sessionId: string;
  question: string;
  answer: string;
  at: number;
  ms: number;
  spawnSessionId: string | null;
}

export interface DiaryData {
  diaries: Record<string, Diary>;
  seances: Seance[];
  spawns: string[];
}

export interface SiteStats {
  sessions: number;
  messages: number;
  tokens: number;
  costUsd: number;
  firstAt: number | null;
  lastAt: number | null;
}
