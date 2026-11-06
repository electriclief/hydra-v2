/**
 * @module card
 * @description Deterministic digest of a session: no model, no network, no cost. Everything the
 *              site shows before an LLM diary exists comes from here, and every LLM diary is
 *              handed this same card as its evidence.
 * @intent A diary must be cheap enough to write 449 times instantly and honest enough that the
 *         LLM pass only has to add prose, never discovery.
 */

import type { Call, Card, MessageRecord, SessionRecord, ToolCount, Turn } from './types.js';
import { SessionStore } from './store.js';

const PATH_KEYS = ['path', 'file_path', 'filePath', 'target', 'file', 'source', 'dest', 'destination', 'output', 'dir', 'directory'];
const WRITE_TOOLS = new Set(['write_file', 'patch', 'edit_file', 'apply_patch', 'str_replace_editor', 'create_file', 'mkdir']);
const SHELL_TOOLS = new Set(['terminal', 'run_command', 'shell', 'powershell', 'bash']);
const TEXT_CAPS = { user: 4000, assistant: 6000, tool: 1400 };

export function oneLine(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Strip the scaffolding Hermes wraps around injected context, keep the human's words. */
export function cleanContent(raw: string): string {
  let text = raw;
  text = text.replace(/\[OUT-OF-BAND USER MESSAGE[^\]]*\]/g, '').replace(/\[\/OUT-OF-BAND USER MESSAGE\]/g, '');
  text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

interface ParsedCall {
  name: string;
  argsRaw: string;
  args: unknown;
}

function parseToolCalls(raw: string | null): ParsedCall[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const out: ParsedCall[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const fn = (record.function ?? record) as Record<string, unknown>;
    const name = String(fn.name ?? record.name ?? record.tool_name ?? 'tool');
    let argsRaw: string;
    const argsValue = fn.arguments ?? record.arguments ?? record.parameters ?? record.input;
    if (typeof argsValue === 'string') argsRaw = argsValue;
    else if (argsValue && typeof argsValue === 'object') argsRaw = JSON.stringify(argsValue);
    else argsRaw = '';
    let args: unknown = null;
    try {
      args = argsRaw ? JSON.parse(argsRaw) : null;
    } catch {
      args = null;
    }
    out.push({ name, argsRaw, args });
  }
  return out;
}

/** One human-readable line for a tool call: the command, the path, or the first useful value. */
export function callBrief(call: ParsedCall): string {
  const args = (call.args ?? {}) as Record<string, unknown>;
  const strings: string[] = [];
  for (const key of PATH_KEYS) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) strings.push(value.trim());
  }
  if (typeof args.command === 'string' && args.command.trim()) {
    return oneLine(args.command.split('\n')[0], 180);
  }
  if (typeof args.pattern === 'string' && args.pattern.trim() && strings.length === 0) {
    return oneLine(args.pattern, 120);
  }
  if (strings.length > 0) return oneLine(strings[0], 180);
  if (typeof args.query === 'string') return oneLine(args.query, 140);
  if (typeof args.url === 'string') return oneLine(args.url, 140);
  const first = Object.values(args).find((value) => typeof value === 'string' && value.trim());
  if (typeof first === 'string') return oneLine(first, 160);
  return oneLine(call.argsRaw, 160);
}

function looksLikePath(value: string): boolean {
  if (value.length < 3 || value.length > 400) return false;
  if (/[\n\r]/.test(value)) return false;
  if (/^(https?:|data:|mailto:)/i.test(value)) return false;
  return /[\\/]/.test(value) || /\.(ts|tsx|js|jsx|py|json|md|html|css|yaml|yml|toml|txt|sh|ps1|cmd|bat|db|sqlite|png|jpg|jpeg|webp|svg|pdf|zip|gguf|safetensors)$/i.test(value);
}

export function extractFiles(messages: MessageRecord[]): string[] {
  const weighted = new Map<string, number>();
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const call of parseToolCalls(message.toolCalls)) {
      const args = (call.args ?? {}) as Record<string, unknown>;
      const bump = WRITE_TOOLS.has(call.name) ? 3 : 1;
      for (const key of PATH_KEYS) {
        const value = args[key];
        if (typeof value === 'string' && looksLikePath(value.trim())) {
          const clean = value.trim();
          weighted.set(clean, (weighted.get(clean) ?? 0) + bump);
        }
      }
      if (WRITE_TOOLS.has(call.name) && typeof args.path !== 'string') {
        const first = Object.values(args).find((value) => typeof value === 'string' && looksLikePath(value));
        if (typeof first === 'string') weighted.set(first, (weighted.get(first) ?? 0) + bump);
      }
      // Commands name their own working files often enough to be worth a shallow scan.
      if (typeof args.command === 'string') {
        for (const match of args.command.matchAll(/[A-Za-z]:\\[^\s"'|<>]+/g)) {
          if (looksLikePath(match[0])) weighted.set(match[0], (weighted.get(match[0]) ?? 0) + 1);
        }
      }
    }
  }
  return [...weighted.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 24)
    .map(([file]) => file);
}

export function extractCommands(messages: MessageRecord[]): string[] {
  const seen = new Map<string, number>();
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const call of parseToolCalls(message.toolCalls)) {
      if (!SHELL_TOOLS.has(call.name)) continue;
      const args = (call.args ?? {}) as Record<string, unknown>;
      const command = typeof args.command === 'string' ? args.command : '';
      if (!command.trim()) continue;
      const line = oneLine(command.split('\n')[0].trim(), 150);
      seen.set(line, (seen.get(line) ?? 0) + 1);
    }
  }
  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 14)
    .map(([command]) => command);
}

export function toolCounts(messages: MessageRecord[]): ToolCount[] {
  const counts = new Map<string, number>();
  for (const message of messages) {
    if (message.role === 'tool' && message.toolName) {
      counts.set(message.toolName, (counts.get(message.toolName) ?? 0) + 1);
      continue;
    }
    if (message.role === 'assistant' && message.toolCalls) {
      for (const call of parseToolCalls(message.toolCalls)) {
        counts.set(call.name, (counts.get(call.name) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));
}

function buildTurns(messages: MessageRecord[]): Turn[] {
  const turns: Turn[] = [];
  for (const message of messages) {
    if (message.role === 'session_meta') continue;
    if (message.role === 'user') {
      turns.push({ role: 'user', at: message.timestamp, text: clip(cleanContent(message.content), TEXT_CAPS.user) });
      continue;
    }
    if (message.role === 'assistant') {
      const text = cleanContent(message.content);
      const calls: Call[] = parseToolCalls(message.toolCalls).map((call) => ({ name: call.name, brief: callBrief(call) }));
      turns.push({
        role: 'assistant',
        at: message.timestamp,
        text: clip(text, TEXT_CAPS.assistant),
        calls,
      });
      continue;
    }
    if (message.role === 'tool') {
      turns.push({
        role: 'tool',
        at: message.timestamp,
        toolName: message.toolName ?? 'tool',
        text: clip(message.content, TEXT_CAPS.tool),
      });
      continue;
    }
    turns.push({ role: 'other', at: message.timestamp, text: clip(cleanContent(message.content), 600) });
  }
  return turns;
}

function clip(text: string, cap: number): string {
  if (text.length <= cap) return text;
  return `${text.slice(0, cap)}\n\n[…${text.length - cap} chars trimmed — full text: hermes sessions export --session-id <id> --format md]`;
}

/**
 * Hermes injects its own turns into the user role (compaction, handoff, background notifications,
 * mid-turn steering). Those are evidence, but they are never "what the human asked for".
 */
export function isInjectedTurn(text: string): boolean {
  return /^\[(CONTEXT COMPACTION|Context from the interrupted|IMPORTANT: Background process|OUT-OF-BAND|SYSTEM)/i.test(
    text.trim(),
  ) || /^<system-reminder>/i.test(text.trim());
}

export function buildCard(session: SessionRecord, messages: MessageRecord[]): Card {
  const turns = buildTurns(messages);
  const userMessages = turns.filter((turn) => turn.role === 'user');
  const assistantMessages = turns.filter((turn) => turn.role === 'assistant' && turn.text.trim().length > 0);
  const realAsk = userMessages.find((turn) => !isInjectedTurn(turn.text)) ?? userMessages[0];
  const goal = realAsk ? oneLine(realAsk.text, 700) : '';
  const outcome = assistantMessages.length > 0 ? oneLine(assistantMessages[assistantMessages.length - 1].text, 900) : '';
  const durationSec =
    session.startedAt && session.endedAt && session.endedAt > session.startedAt
      ? Math.round(session.endedAt - session.startedAt)
      : null;
  return {
    ...session,
    ref: SessionStore.refFor(session.id),
    displayTitle: session.title?.trim() || goal.slice(0, 80) || `${session.source} session ${SessionStore.refFor(session.id)}`,
    durationSec,
    userTurns: userMessages.length,
    goal,
    outcome,
    files: extractFiles(messages),
    commands: extractCommands(messages),
    tools: toolCounts(messages),
    turns,
    bytes: messages.reduce((sum, message) => sum + message.content.length + (message.toolCalls?.length ?? 0), 0),
  };
}
