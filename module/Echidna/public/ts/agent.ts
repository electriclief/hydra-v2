/**
 * @module agent
 * @description The one seam between this door and the agent itself: run Hermes once, return what it said.
 * @intent A talk pane that fakes an answer is worse than no talk pane. This module spawns the real agent
 *         (`hermes chat --query-file … --oneshot -Q`), gives it a timeout it cannot hang past, and returns the
 *         answer plus how long it took. Every failure is returned as text the operator can read, never as a
 *         silent empty bubble.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface AgentConfig {
  /** The hermes executable. */
  bin: string;
  /** Where prompts are written (one file per ask, kept for evidence). */
  promptDir: string;
  /** How long one answer may take before it is killed. */
  timeoutMs: number;
  /** Continue an existing Hermes session instead of starting a new one, when the caller has an id. */
  session?: string | null;
}

export interface AgentRun {
  ok: boolean;
  text: string;
  ms: number;
  /** The hermes session id parsed out of its own output, when it printed one. */
  sessionId: string | null;
  error: string | null;
}

/** Strip the agent's console decoration so the pane shows the answer, not the transcript of a terminal. */
export function extractAnswer(stdout: string, stderr: string): string {
  const raw = String(stdout || '').replace(/\r\n/g, '\n');
  // A one-shot run ends with the answer; everything the CLI prints on the way there (banners, session ids, tool
  // traces) is noise for a talk pane. Take the text after the last separator block, else the last non-empty block.
  const blocks = raw.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const noise = /^(hermes|session_id|model|tokens|elapsed|usage)\b/i;
  const kept = blocks.filter((b) => !noise.test(b));
  const answer = (kept.length ? kept : blocks).slice(-1)[0] || '';
  if (answer) return answer;
  const err = String(stderr || '').trim();
  return err ? `(the agent said nothing on stdout)\n${err}` : '(the agent returned no text)';
}

/**
 * Ask once. Resolves with ok:false rather than throwing: a failed ask is a turn in the conversation, and the
 * operator should see why it failed in the same place they see answers.
 */
export async function ask(config: AgentConfig, prompt: string, askId: string): Promise<AgentRun> {
  const started = Date.now();
  fs.mkdirSync(config.promptDir, { recursive: true });
  const file = path.join(config.promptDir, `${askId}.txt`);
  fs.writeFileSync(file, prompt, 'utf8');

  const args = ['chat', '--query-file', file, '--oneshot', '-Q'];
  if (config.session) args.push('--resume', config.session);

  return new Promise<AgentRun>((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (run: AgentRun) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(run);
    };
    let child;
    try {
      // hermes is a real .exe here, so an argv array is used: going through the shell re-quotes the prompt path.
      child = spawn(config.bin, args, {
        windowsHide: true,
        env: { ...process.env, HERMES_NO_UPDATE_CHECK: '1' },
      });
    } catch (error) {
      finish({ ok: false, text: '', ms: 0, sessionId: null, error: (error as Error).message });
      return;
    }
    const timer = setTimeout(() => {
      try {
        if (child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      } catch {
        /* best effort */
      }
      finish({
        ok: false,
        text: '',
        ms: Date.now() - started,
        sessionId: null,
        error: `the agent did not answer within ${Math.round(config.timeoutMs / 1000)}s`,
      });
    }, config.timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => finish({ ok: false, text: '', ms: Date.now() - started, sessionId: null, error: error.message }));
    child.on('close', (code) => {
      const sessionId = /session_id:\s*([A-Za-z0-9._-]+)/.exec(`${stdout}\n${stderr}`)?.[1] ?? null;
      const text = extractAnswer(stdout, stderr);
      finish({
        ok: code === 0,
        text,
        ms: Date.now() - started,
        sessionId,
        error: code === 0 ? null : `hermes exited ${code}`,
      });
    });
  });
}

export interface AgentStreamEvent {
  kind: 'delta' | 'meta';
  text?: string;
  model?: string | null;
  tokens?: unknown;
}

export interface AgentStreamRun extends AgentRun {
  tokens?: unknown;
  model?: string | null;
}

/**
 * The same ask, read while it is being written.
 *
 * `hermes chat --format stream-json` prints one JSON object per line: a `system` init, a run of `text` deltas, then a
 * `result` carrying the authoritative answer, the session id and the token counts. This function forwards the deltas
 * as they arrive and still resolves with a complete run, so a caller that only wants the answer can ignore the
 * events and a caller that wants to draw can ignore the return - and the answer on disk is identical either way.
 */
export function askStream(
  config: AgentConfig,
  prompt: string,
  askId: string,
  onEvent?: (event: AgentStreamEvent) => void,
): Promise<AgentStreamRun> {
  const started = Date.now();
  fs.mkdirSync(config.promptDir, { recursive: true });
  const file = path.join(config.promptDir, `${askId}.txt`);
  fs.writeFileSync(file, prompt, 'utf8');
  const args = ['chat', '--query-file', file, '--oneshot', '-Q', '--format', 'stream-json'];
  if (config.session) args.push('--resume', config.session);

  return new Promise<AgentStreamRun>((resolve) => {
    let buf = '';
    let deltas = '';
    let sessionId: string | null = null;
    let finalText: string | null = null;
    let tokens: unknown = null;
    let model: string | null = null;
    let settled = false;
    const say = (event: AgentStreamEvent) => {
      try {
        onEvent?.(event);
      } catch {
        /* a listener that throws must not take the run down */
      }
    };
    const finish = (run: AgentStreamRun) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(run);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(config.bin, args, { windowsHide: true, env: { ...process.env, HERMES_NO_UPDATE_CHECK: '1' } });
    } catch (error) {
      finish({ ok: false, text: '', ms: 0, sessionId: null, error: (error as Error).message });
      return;
    }
    const timer = setTimeout(() => {
      try {
        if (child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      } catch {
        /* already gone */
      }
      finish({
        ok: false,
        text: deltas,
        ms: Date.now() - started,
        sessionId,
        error: `the agent did not answer within ${Math.round(config.timeoutMs / 1e3)}s`,
      });
    }, config.timeoutMs);

    const handle = (raw: string) => {
      const line = raw.trim();
      if (!line) return;
      if (!line.startsWith('{')) {
        const m = /^Session:\s*([A-Za-z0-9._-]+)/.exec(line);
        if (m) sessionId = m[1];
        return;
      }
      let evt: Record<string, unknown>;
      try {
        evt = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return;
      }
      if (evt.type === 'system') {
        if (typeof evt.session_id === 'string' && evt.session_id) sessionId = evt.session_id;
        if (typeof evt.model === 'string' && evt.model) {
          model = evt.model;
          say({ kind: 'meta', model });
        }
      } else if (evt.type === 'text' && typeof evt.text === 'string') {
        deltas += evt.text;
        say({ kind: 'delta', text: evt.text });
      } else if (evt.type === 'result') {
        if (typeof evt.session_id === 'string' && evt.session_id) sessionId = evt.session_id;
        if (typeof evt.text === 'string' && evt.text.trim()) finalText = evt.text;
        if (evt.tokens) tokens = evt.tokens;
        if (typeof evt.duration_ms === 'number') say({ kind: 'meta', tokens: evt.tokens ?? null });
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      let idx = buf.indexOf('\n');
      while (idx >= 0) {
        handle(buf.slice(0, idx));
        buf = buf.slice(idx + 1);
        idx = buf.indexOf('\n');
      }
    });
    child.on('error', (error: Error) =>
      finish({ ok: false, text: deltas, ms: Date.now() - started, sessionId, error: error.message }),
    );
    child.on('close', (code: number | null) => {
      if (buf.trim()) handle(buf);
      const text = String(finalText ?? deltas).trim();
      finish({
        ok: code === 0 && Boolean(text),
        text: text || (code === 0 ? '(the agent returned no text)' : ''),
        ms: Date.now() - started,
        sessionId,
        tokens,
        model,
        error: code === 0 ? null : `hermes exited ${code}`,
      });
    });
  });
}
