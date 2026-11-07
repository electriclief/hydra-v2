/**
 * Echidna — the door. `node public/js/main.js` starts it on 127.0.0.1:8138.
 *
 *   node public/js/main.js                # serve
 *   node public/js/main.js --port 8138    # explicit port
 *   node public/js/main.js --agent <exe>  # a different hermes binary
 *   node public/js/main.js --data <dir>   # a different thread/easy.json (tests)
 *
 * The agent binary defaults to this rig's hermes.exe and falls back to `hermes` on PATH. The binary is reported in
 * /api/state, so a pane can say "no agent here" before it wastes an ask.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from './server.js';

const MODULE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const RIG_HERMES = 'C:/Users/User/AppData/Local/hermes/hermes-agent/.hermes/bin/hermes.exe';

export interface MainOptions {
  port: number;
  host: string;
  publicDir: string;
  dataDir: string;
  agentBin: string;
  timeoutMs: number;
  /** The State door this node publishes the conversation to. */
  stateUrl: string;
  /** The ref the conversation is published under. */
  nodeRef: string;
  /** This node's Mirror, for reading a conversation hosted on another node. */
  mirrorUrl: string;
  /** Serve another node's conversation; never publish a branch of our own. */
  readOnly: boolean;
  /** The approved rig directory whose character records drive the faces. */
  rigDir: string;
  /** The LAN speech door this node asks by default. */
  ttsUrl: string;
}

/** The node's own ref, read from the instance layer (never from the repo). */
function nodeRefFromDisk(): string {
  for (const p of ['C:/AI/hydra-local/module/Menu/data/node.json', 'C:/AI/hydra-local/module/Core/data/node.json']) {
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8')) as { ref?: string };
      if (j.ref) return String(j.ref);
    } catch {
      /* try the next */
    }
  }
  return 'local';
}

function defaultAgentBin(): string {
  const fromEnv = process.env.ECHIDNA_HERMES;
  if (fromEnv) return fromEnv;
  if (fs.existsSync(RIG_HERMES)) return RIG_HERMES;
  return 'hermes';
}

export function parseArgs(argv: string[], moduleDir = MODULE_DIR): MainOptions {
  const options: MainOptions = {
    port: 8138,
    host: '127.0.0.1',
    publicDir: path.join(moduleDir, 'public'),
    dataDir: path.join(moduleDir, 'data'),
    agentBin: defaultAgentBin(),
    timeoutMs: 300_000,
    stateUrl: process.env.ECHIDNA_STATE ?? 'http://127.0.0.1:8127',
    nodeRef: process.env.ECHIDNA_REF ?? nodeRefFromDisk(),
    mirrorUrl: process.env.ECHIDNA_MIRROR ?? 'http://127.0.0.1:8137',
    readOnly: process.env.ECHIDNA_READONLY === '1',
    rigDir: process.env.ECHIDNA_RIG ?? 'C:/AI/hydra-local/media/characters',
    ttsUrl: process.env.ECHIDNA_TTS ?? 'http://127.0.0.1:8144',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string => String(argv[i + 1] ?? '');
    if (arg === '--port') {
      options.port = Number.parseInt(next(), 10) || options.port;
      i += 1;
    } else if (arg === '--host') {
      options.host = next() || options.host;
      i += 1;
    } else if (arg === '--data') {
      options.dataDir = path.resolve(next());
      i += 1;
    } else if (arg === '--agent') {
      options.agentBin = next() || options.agentBin;
      i += 1;
    } else if (arg === '--state') {
      options.stateUrl = next() || options.stateUrl;
      i += 1;
    } else if (arg === '--node-ref') {
      options.nodeRef = next() || options.nodeRef;
      i += 1;
    } else if (arg === '--view') {
      options.readOnly = true;
      i += 1;
    } else if (arg === '--timeout') {
      options.timeoutMs = (Number.parseInt(next(), 10) || 300) * 1000;
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Echidna — the agent face of this LAN',
          '',
          '  node public/js/main.js [options]',
          '',
          '  --port N      port (default 8138)',
          '  --host H      bind host (default 127.0.0.1; 0.0.0.0 for the LAN)',
          '  --data DIR    thread.jsonl + easy.json live here (default <module>/data)',
          '  --agent EXE   hermes binary (default this rig, then PATH)',
          '  --timeout S   seconds one answer may take (default 300)',
          '',
        ].join('\n'),
      );
      process.exit(0);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const server = createServer({
  port: options.port,
  host: options.host,
  publicDir: options.publicDir,
  dataDir: options.dataDir,
  agent: { bin: options.agentBin, promptDir: path.join(options.dataDir, 'prompts'), timeoutMs: options.timeoutMs },
  stateUrl: options.stateUrl,
  nodeRef: options.nodeRef,
  mirrorUrl: options.mirrorUrl,
  readOnly: options.readOnly,
  rigDir: options.rigDir,
  ttsUrl: options.ttsUrl,
});

server.listen(options.port, options.host, () => {
  process.stdout.write(`[echidna] http://${options.host}:${options.port}\n`);
  process.stdout.write(`[echidna] agent: ${options.agentBin}${fs.existsSync(options.agentBin) ? '' : ' (NOT FOUND)'}\n`);
  process.stdout.write(`[echidna] thread: ${path.join(options.dataDir, 'thread.jsonl')}\n`);
  process.stdout.write(`[echidna] published as node.${options.nodeRef}.echidna to ${options.stateUrl}\n`);
  process.stdout.write(`[echidna] faces: ${options.rigDir}\n`);
  process.stdout.write(`[echidna] voice: ${options.ttsUrl}\n`);
});
