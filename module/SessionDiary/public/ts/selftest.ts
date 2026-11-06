/**
 * @module selftest
 * @description The gate. Builds a fixture store with two sessions, then proves: the card extracts
 *              the right facts, the site is written and opens, the diary prose lands on its page,
 *              a seance is filed, a fork copies and verifies, and the API answers over HTTP.
 *              No model is called — the LLM paths are exercised through their cached branch.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SessionStore } from './store.js';
import { buildCard } from './card.js';
import { Site } from './site.js';
import { stripSessionLine } from './actions.js';
import { startApiServer } from './apiServer.js';
import { Actions } from './actions.js';

let passed = 0;
const failures: string[] = [];

function ok(condition: unknown, label: string): void {
  if (condition) {
    passed += 1;
    process.stdout.write(`  ok  ${label}\n`);
  } else {
    failures.push(label);
    process.stdout.write(`  FAIL ${label}\n`);
  }
}

function eq(actual: unknown, expected: unknown, label: string): void {
  ok(actual === expected, `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

const root = path.join(os.tmpdir(), `sessiondiary-selftest-${process.pid}`);
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(root, { recursive: true });
const dbPath = path.join(root, 'state.db');
const siteDir = path.join(root, 'site');
const dataDir = path.join(root, 'data');

const SCHEMA = `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, user_id TEXT, model TEXT, model_config TEXT,
  system_prompt TEXT, parent_session_id TEXT, started_at REAL NOT NULL, ended_at REAL,
  end_reason TEXT, message_count INTEGER DEFAULT 0, tool_call_count INTEGER DEFAULT 0,
  input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0, cache_read_tokens INTEGER DEFAULT 0,
  cache_write_tokens INTEGER DEFAULT 0, reasoning_tokens INTEGER DEFAULT 0, cwd TEXT,
  billing_provider TEXT, billing_base_url TEXT, billing_mode TEXT, estimated_cost_usd REAL,
  actual_cost_usd REAL, cost_status TEXT, cost_source TEXT, pricing_version TEXT, title TEXT,
  api_call_count INTEGER DEFAULT 0, handoff_state TEXT, handoff_platform TEXT, handoff_error TEXT,
  rewind_count INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, session_key TEXT,
  chat_id TEXT, chat_type TEXT, thread_id TEXT, display_name TEXT, origin_json TEXT,
  expiry_finalized INTEGER DEFAULT 0, git_branch TEXT, git_repo_root TEXT,
  compression_failure_cooldown_until REAL, compression_failure_error TEXT,
  compression_fallback_streak INTEGER NOT NULL DEFAULT 0,
  compression_ineffective_count INTEGER NOT NULL DEFAULT 0, profile_name TEXT,
  pinned INTEGER NOT NULL DEFAULT 0, system_prompt_hash TEXT, last_activity_at REAL,
  last_activity_description TEXT, last_activity_provenance TEXT, last_read_at REAL,
  git_metadata_generation INTEGER, title_source TEXT, hidden INTEGER, compression_recovery_deadline REAL,
  tool_names TEXT, transport_profile TEXT, created_source TEXT, compression_overload_streak INTEGER,
  auto_archived INTEGER, runtime_revision INTEGER, runtime_generation INTEGER, transcript_revision INTEGER
);
CREATE UNIQUE INDEX idx_sessions_title_unique ON sessions(title) WHERE title IS NOT NULL;
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, tool_call_id TEXT,
  tool_calls TEXT, tool_name TEXT, timestamp REAL, token_count INTEGER, finish_reason TEXT,
  reasoning TEXT, reasoning_content TEXT, reasoning_details TEXT, codex_reasoning_items TEXT,
  codex_message_items TEXT, platform_message_id TEXT, observed INTEGER, active INTEGER,
  compacted INTEGER, effect_disposition TEXT, api_content TEXT, display_kind TEXT,
  display_metadata TEXT, _compressed_summary INTEGER, display_identity BLOB, display_order INTEGER,
  message_uid TEXT, absorbed_message_uids TEXT, tool_call_uids TEXT, tool_call_uid TEXT
);
`;

const db = new DatabaseSync(dbPath);
db.exec(SCHEMA);

const callA = JSON.stringify([
  { function: { name: 'terminal', arguments: JSON.stringify({ command: 'npm test --prefix C:/AI/proj' }) } },
]);
const callB = JSON.stringify([
  { function: { name: 'write_file', arguments: JSON.stringify({ path: 'C:\\AI\\proj\\app.ts', content: 'x' }) } },
]);

const sessions = [
  {
    id: 'local-' + 'a'.repeat(64),
    title: 'Build the thing',
    source: 'cli',
    started: 1793000000,
    ended: 1793000600,
    messages: [
      { role: 'user', content: 'Build the thing and run the tests.' },
      { role: 'assistant', content: '', toolCalls: callA },
      { role: 'tool', toolName: 'terminal', content: 'Tests fail: 3 failures' },
      { role: 'assistant', content: '', toolCalls: callB },
      { role: 'tool', toolName: 'write_file', content: 'written' },
      { role: 'assistant', content: 'Fixed the parser and the suite is green. Next: ship it.' },
    ],
  },
  {
    id: 'local-' + 'b'.repeat(64),
    title: 'Nightly sweep',
    source: 'cron',
    started: 1792900000,
    ended: 1792900100,
    messages: [{ role: 'user', content: 'Sweep the releases.' }],
  },
];

for (const session of sessions) {
  db.prepare(
    `INSERT INTO sessions (id, source, title, model, started_at, ended_at, end_reason, message_count,
       tool_call_count, input_tokens, output_tokens, estimated_cost_usd, cwd, git_branch, archived,
       pinned, hidden, profile_name, last_activity_at, created_source, transcript_revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 'default', ?, 'cli', 0)`,
  ).run(
    session.id,
    session.source,
    session.title,
    'deepseek-flash',
    session.started,
    session.ended,
    'user_exit',
    session.messages.length,
    2,
    1000,
    200,
    0.0123,
    'C:\\AI\\proj',
    'main',
    session.ended,
  );
  let offset = 0;
  for (const message of session.messages) {
    db.prepare(
      `INSERT INTO messages (session_id, role, content, tool_calls, tool_name, timestamp, active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
    ).run(
      session.id,
      message.role,
      message.content,
      'toolCalls' in message ? String(message.toolCalls) : null,
      'toolName' in message ? String(message.toolName) : null,
      session.started + offset,
    );
    offset += 5;
  }
}
db.close();

process.stdout.write('store + card\n');
const store = new SessionStore({ dbPath, readOnly: true });
const listed = store.listSessions();
eq(listed.length, 2, 'two sessions listed');
const parent = listed.find((session) => session.id.endsWith('a'.repeat(20)))!;
ok(Boolean(parent), 'parent session found');
const messages = store.messages(parent.id);
eq(messages.length, 6, 'six messages read');

const card = buildCard(parent, messages);
eq(card.ref.length, 8, 'ref is 8 hex chars');
ok(/^[0-9a-f]{8}$/.test(card.ref), 'ref is hex');
ok(card.goal.includes('Build the thing'), 'goal is the first user turn');
ok(card.outcome.includes('suite is green'), 'outcome is the last assistant turn');
ok(card.files.includes('C:\\AI\\proj\\app.ts'), 'files: written path captured');
ok(card.commands.some((command) => command.includes('npm test')), 'commands: shell line captured');
ok(card.tools.some((tool) => tool.name === 'terminal' && tool.count >= 1), 'tools: terminal counted');
eq(card.durationSec, 600, 'duration from start/end');
eq(card.userTurns, 1, 'one user turn');
store.close(); // Windows: an open handle makes the fixture undeletable and hides the real result

process.stdout.write('\nsite\n');
const site = new Site({ dbPath, siteDir, dataDir, apiBase: 'http://127.0.0.1:8134' });
const report = site.build();
eq(report.sessions, 2, 'two session pages built');
ok(fs.existsSync(path.join(siteDir, 'read_dir_indexer.html')), 'index page written');
ok(fs.existsSync(path.join(siteDir, 'custom.css')), 'stylesheet written');
ok(fs.existsSync(path.join(siteDir, 'custom.js')), 'script written');
ok(fs.existsSync(path.join(siteDir, `session_${card.ref}.html`)), 'session page named session_<ref>.html');

const indexHtml = fs.readFileSync(path.join(siteDir, 'read_dir_indexer.html'), 'utf8');
ok(indexHtml.includes('window.SD_INDEX='), 'index carries its data inline (works from file://)');
ok(indexHtml.includes('Build the thing'), 'index lists the session');
ok(indexHtml.includes('custom.css') && indexHtml.includes('custom.js'), 'index links the shared assets');
ok(!indexHtml.includes('http://127.0.0.1:8134/custom'), 'assets are relative, not absolute');

const pageFile = path.join(siteDir, `session_${card.ref}.html`);
const pageHtml = fs.readFileSync(pageFile, 'utf8');
ok(pageHtml.includes(`hermes --resume ${parent.id}`), 'shortcut: resume command');
ok(pageHtml.includes('Talk to the dead'), 'shortcut: ask block');
ok(pageHtml.includes('C:\\AI\\proj\\app.ts'), 'evidence: file path on the page');
ok(pageHtml.includes('window.SD_SESSION='), 'session page carries its data inline');

process.stdout.write('\ndiary + seance\n');
site.data.setDiary(parent.id, { text: 'It was built.\n\nIt ended green.', model: 'test-model', at: Date.now(), ms: 1234 });
site.data.addSeance({
  sessionId: parent.id,
  question: 'did the tests pass?',
  answer: 'Yes — three failures were fixed and the suite went green.',
  at: Date.now(),
  ms: 4200,
  spawnSessionId: 'local-' + 'c'.repeat(64),
});
ok(site.rebuildOne(parent.id), 'rebuildOne rewrote the page');
const afterHtml = fs.readFileSync(pageFile, 'utf8');
ok(afterHtml.includes('It was built.'), 'diary prose rendered');
ok(afterHtml.includes('did the tests pass?'), 'seance question rendered');
ok(afterHtml.includes('suite went green'), 'seance answer rendered');

const indexJson = JSON.parse(fs.readFileSync(path.join(siteDir, 'data', 'index.json'), 'utf8')) as {
  rows: { id: string; hasDiary: boolean; hasSeance: boolean }[];
};
eq(indexJson.rows.length, 2, 'index.json has both rows');
ok(indexJson.rows.find((row) => row.id === parent.id)?.hasDiary === true, 'index.json marks the diary');
ok(fs.existsSync(path.join(siteDir, 'data', 'sessions', `${card.ref}.json`)), 'lean per-session json written');

process.stdout.write('\nfork\n');
const writer = new SessionStore({ dbPath, readOnly: false });
const fork1 = writer.fork(parent.id, { backupDir: path.join(dataDir, 'backups') });
ok(fork1.verified, 'fork reports verified');
eq(fork1.messages, 6, 'fork copied 6 messages');
ok(fork1.newId !== parent.id, 'fork has a new id');
ok(fs.existsSync(String(fork1.backup)), 'backup file exists');
const fork2 = writer.fork(parent.id, { backupDir: path.join(dataDir, 'backups') });
ok(fork2.title !== fork1.title, 'second fork gets a unique title');
const childRow = (writer as unknown as { db: DatabaseSync }).db
  .prepare('SELECT parent_session_id, title FROM sessions WHERE id = ?')
  .get(fork1.newId) as { parent_session_id: string; title: string };
eq(childRow.parent_session_id, parent.id, 'child points at its parent');
writer.close();

const verify = new SessionStore({ dbPath, readOnly: true });
eq(verify.messages(fork1.newId).length, 6, 'fork transcript readable after the fact');
verify.close();

process.stdout.write('\napi\n');
const actions = new Actions({ dbPath, dataDir, hermesBin: 'hermes', timeoutMs: 1000, model: 'deepseek-flash' });
const api = await startApiServer({ site, actions, dbPath, port: 0, host: '127.0.0.1' });
try {
  const health = await fetch(`${api.url}/health`).then((response) => response.json() as Promise<Record<string, unknown>>);
  eq(health.ok, true, '/health ok');
  eq(health.door, 'SessionDiary', '/health names the door');

  const list = (await fetch(`${api.url}/api/sessions`).then((response) => response.json())) as {
    total: number;
    rows: { source: string }[];
  };
  eq(list.total, 1, 'list hides cron by default');
  ok(list.rows.every((row) => row.source !== 'cron'), 'no cron rows in the default list');

  const quiet = (await fetch(`${api.url}/api/sessions?quiet=1`).then((response) => response.json())) as { total: number };
  eq(quiet.total, 2, 'quiet=1 shows everything');

  const one = await fetch(`${api.url}/api/sessions/${card.ref}`).then((response) => response.json() as Promise<Record<string, any>>);
  eq(one.ok, true, 'session readable by ref');
  ok(String((one.session as { goal: string }).goal).includes('Build the thing'), 'session payload carries the goal');

  const cached = await fetch(`${api.url}/api/diary/${card.ref}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }).then((response) => response.json() as Promise<Record<string, any>>);
  eq(cached.cached, true, 'diary route returns the cached prose without calling a model');

  const pre = await fetch(`${api.url}/api/ask`, {
    method: 'OPTIONS',
  });
  eq(pre.status, 204, 'CORS preflight answered for file:// pages');

  const page = await fetch(`${api.url}/site/read_dir_indexer.html`);
  eq(page.status, 200, 'site served over http as well');
} finally {
  await api.stop();
}

process.stdout.write('\nhelpers\n');
eq(stripSessionLine('the answer\n\nsession_id: local-abc\n'), 'the answer', 'session_id line stripped');
eq(stripSessionLine('line one\nline two\n'), 'line one\nline two', 'plain text untouched');

process.stdout.write(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const failure of failures) process.stdout.write(`  - ${failure}\n`);
  process.exit(1);
}
fs.rmSync(root, { recursive: true, force: true });
