# ProcessWrapper

Takes a process command (`foo.exe`, `"python bar.py"`), launches it as a child process,
captures its output as a **text stream**, and serves an **API** that can launch new
processes, hand out a **copy** of a process's output stream, and **kill** a process.

Structure-first: plain ES modules, no dependencies at runtime, every module carries its own
self-check, and the whole thing is gated by one command.

## The two laws kept here

1. **ONE LIFE = ONE FILE.** Every process life gets its own append-only text file under
   `data/streams/<id>.log` — never rotated, whole while the process is alive, kept at death
   until an operator deletes it. The RAM buffer is a convenience for fast copies; the file is
   the ground truth. When the RAM ceiling sheds text, the record says so (`truncated: true`)
   and the file still holds it all.
2. **NOTHING HIDDEN.** A child process only ever comes from `processWrapper.launch()`, and
   every child is in the table with its id, pid, life, exit code and stream file. There is no
   second place a process can live.

## Layout

```
public/ts/     TypeScript sources (one feature per file: header · interfaces · functions · runTests)
public/ts/browser/  browser-only sources (loaded by the page as native ES modules)
public/js/     compiled ES modules, one .js per .ts (esbuild)
public/css/    the GUI stylesheet
public/media/  assets (unused for now)
public/index.html   the GUI page served at /
data.yaml      the saved-commands registry (ground truth for what this box can launch)
data/streams/  one text file per process life (created at runtime)
ProcessWrapper_module.js  THE ONE FILE LOADED by another code thread — the embed entry (createModule/startModule)
Docs/          the module docs — index.html (purpose + every .d.ts; the ONE file agents read) + index.css
scripts/       build-docs.cjs — regenerates Docs/ (`npm run docs`) · system-sampler.ps1 — the drain watch's eyes
```

The browser loads `/js/browser/gui.js` as a native ES module — no bundler, because the page
and Node resolve the same relative imports. `mount()` does nothing without a DOM, so the gate
can import the module headless and self-check its pure half.

## Core Modules

| Module File | Reason / Functionality |
| :--- | :--- |
| `processWrapper.ts` | THE TABLE: argv parsing, spawn, per-life text capture to a file, live RAM buffer, line events, stdin, kill (graceful → force tree-kill), `awaitExit`. Everything else rides on it. |
| `streamHub.ts` | Hands out COPIES of a running process's stream — one independent cursor per consumer, replay-from-offset, honest backpressure (a slow reader queues, and is told when it sheds text). |
| `apiServer.ts` | The HTTP face: launch / list / copy output / follow live over SSE / write stdin / kill / saved commands, plus the static files and the MCP mount. Dependency-free (`node:http`), optional shared token. |
| `mcpServer.ts` | The AGENT face: an MCP server at `POST /mcp` — 13 self-describing tools covering every option, `initialize` instructions that explain the laws, JSON-RPC over HTTP (plain JSON or SSE frames), sessions, and the process lives as resources. |
| `mcpRegistry.ts` | THE AGENT FACE AS A REGISTRY (list + call, MCP-shaped): the same tool table the module's own /mcp serves, mountable elsewhere (Api_Root) — one implementation, so they cannot drift. Exported from the embed entry as `createPwMcpRegistry()`. |
| `staticFiles.ts` | Serves `public/` on the same port — the GUI, its CSS, its module. MIME map, index fallback, traversal guard, and a 404 that points at the API. |
| `browser/gui.ts` | The page: start a process, watch the table live, follow a stream, feed stdin, kill. Pure renderers (self-checked by the gate) + `mount()` for the DOM wiring; loaded natively as an ES module. |
| `client.ts` | The ES-module client for the API — `fetch` in Node or the browser, one SSE reader, API errors thrown as `ProcessWrapperError` with the server's own code. |
| `registryStore.ts` | The saved-commands registry: a small YAML codec plus `stateToYaml`/`yamlToState`/`addCommand`/`updateCommand`/`removeCommand`/`toSpec` over `data.yaml`. |
| `main.ts` | The entry point: flags/environment → wrapper + hub + API (GUI + MCP) on a port, plus the banner and signal handling. |
| `systemWatch.ts` | THE DRAIN WATCH: launches the sampler through the table (nothing hidden), turns its lines into a small event log (`data/watch/`) and a `note System Drain` event for every drain — so "it was slow" has receipts. CPU + disks only; the expected list is a tool, not a rule. |
| `cli.ts` | The terminal face (`pw …`): start, list, show, output, follow, input, kill, rm, commands, save, unsave — a thin translator over `client.ts`, no second implementation. |
| `selftest.ts` | THE GATE: runs every module's own self-check in one command, counts `console.assert` failures per module, prints GREEN/RED and exits non-zero on failure. |
| `ProcessWrapper_module.js` | THE EMBED ENTRY: the one file another code thread loads — re-exports the whole surface and adds `createModule()` / `startModule()`. Its own check: `node ProcessWrapper_module.js`. |
| `Docs/index.html` | THE ONE FILE AGENTS READ: purpose + the `.d.ts` contract of every file. Generated by `scripts/build-docs.cjs` (`npm run docs`); `index.css` is style only. |

## Quick start

```bash
npm install                # esbuild, typescript, @types/node (dev only)
npm run build              # public/ts/**/*.ts → public/js/*.js
npm run typecheck          # tsc --noEmit (strict) — esbuild does not type-check
npm run selftest           # the gate: every module's own self-check → 423 checks
npm run docs               # writes Docs/index.html (purpose + every .d.ts) and Docs/types/

npm start                  # GUI + API + MCP on http://127.0.0.1:8125
                           #   GUI  http://127.0.0.1:8125/
                           #   API  /api/processes …
                           #   MCP  POST /mcp
npm run cli -- help        # the same thing from a terminal
```

Flags (also readable from the environment as `PW_PORT`, `PW_HOST`, `PW_TOKEN`,
`PW_STREAM_DIR`, `PW_REGISTRY`, `PW_GRACE_MS`; a flag beats the environment):

| Flag | Default | Meaning |
| :--- | :--- | :--- |
| `--port` | `8125` | API port (`0` asks the OS for a free one) |
| `--host` | `127.0.0.1` | bind interface — **local unless you say otherwise** |
| `--token` | *(none)* | shared secret; then every request needs `x-pw-token` or `?token=` |
| `--stream-dir` | `./data/streams` | where the per-life text files land |
| `--registry` | `./data.yaml` | the saved-commands registry |
| `--buffer-limit` | `4000000` | RAM ceiling per process, in characters |
| `--grace-ms` | `3000` | how long a graceful kill waits before it is forced |
| `--watch` / `--no-watch` | on | the drain watch (`systemWatch`): a sampler child in the table, small event logs under `data/watch/`, and a `note System Drain` event per drain |

Server settings live on the flags/environment **only** — `data.yaml` belongs to the saved
commands, and the server never rewrites a part of it it does not own.

## API

| Method + path | What it does |
| :--- | :--- |
| `GET /health` | liveness + counters (processes, live, copies, saved commands) |
| `GET /api/processes?life=&tag=` | the table, newest first |
| `POST /api/processes` | launch `{command:"python bar.py", args?, cwd?, env?, name?, tag?, shell?}` **or** `{saved:"<name>"}` |
| `GET /api/processes/:id` | one record + its buffer status + its stream file |
| `GET /api/processes/:id/output?from=&limit=&channel=` | **a copy of the text** (`text/plain`; offsets in the `x-pw-*` headers) |
| `GET /api/processes/:id/stream?from=&channel=` | **a live copy** of the stream, server-sent events (`open`, `chunk`, `drop`, `end`) |
| `GET /api/processes/:id/file` | where the ground-truth text of that life is |
| `POST /api/processes/:id/input` | write to stdin `{text:"..."}` (raw body also accepted) |
| `POST /api/processes/:id/kill` | kill `{force?:bool, graceMs?:number}` → `{kill:{outcome, forced, pid}}` |
| `DELETE /api/processes/:id` | kill (if alive) + drop the record; the life file stays |
| `GET/POST /api/commands`, `DELETE /api/commands/:name` | the saved commands in `data.yaml` |

Errors are always `{error:{code,message}}` with a real code: `not_found`, `bad_json`,
`no_such_command`, `command_rejected`, `unauthorized`, `stdin_closed`, `launch_failed`,
`no_route`.

```bash
curl -s -X POST localhost:8125/api/processes \
     -H 'content-type: application/json' \
     -d '{"command":"python bar.py","name":"bar"}'

curl -s localhost:8125/api/processes/bar-001-ab12/output          # the whole life, as text
curl -N localhost:8125/api/processes/bar-001-ab12/stream          # live copy (SSE)
curl -s -X POST localhost:8125/api/processes/bar-001-ab12/kill -d '{"force":true}'
```

## Using it as a module (ES)

```js
import { createWrapper } from './public/js/processWrapper.js';
import { createStreamHub } from './public/js/streamHub.js';
import { startApiServer } from './public/js/apiServer.js';

const wrapper = createWrapper({ streamDir: './data/streams' });
const hub = createStreamHub(wrapper);
const api = await startApiServer({ wrapper, hub, port: 8125 });

const rec = wrapper.launch({ command: 'python bar.py', name: 'bar' });
hub.open(rec.id, {
  onData: (chunk) => process.stdout.write(chunk.text),   // return false to apply backpressure
  onEnd: (reason) => console.log('ended:', reason),
  onDrop: (info) => console.log('this copy shed', info.droppedChars, 'chars'),
});

// or talk to a wrapper over the port
import { createProcessClient } from './public/js/client.js';
const client = createProcessClient({ baseUrl: 'http://127.0.0.1:8125' });
for await (const ev of client.stream(rec.id, { from: 0 })) {
  if (ev.event === 'chunk') process.stdout.write(String(ev.data.text));
  if (ev.event === 'end') break;
}
```

## The GUI (the root of the port)

Open `http://127.0.0.1:8125/` — one screen for the whole wrapper:

- **start**: a command field (or pick a saved command and launch it by name); the options
  drawer takes name, tag, cwd, env (JSON or `KEY=VALUE` lines) and the shell toggle.
- **processes**: the live table — id, name, pid, life, characters captured, uptime, exit code,
  and per-row `view` / `kill` / `force` (or `forget` once the life ended). Refreshes itself
  every 2 seconds.
- **stream**: the selected process's captured text, `follow live` to append as it arrives
  (server-sent events), a channel filter (`both` / `stdout` / `stderr`), `load whole`, and a
  stdin box — type and press Enter to write to the child.
- **saved commands**: everything in `data.yaml`, one click to launch, one to drop, plus a form
  to save the command you just ran.
- **token**: the header field stores a shared secret in `localStorage` when the box is guarded
  (`--token`). The page and its files are served WITHOUT a token — everything that acts
  (`/api/*`, `/mcp`) needs it.

## The MCP endpoint (for agents)

`POST /mcp` is a streamable-HTTP MCP server. It exposes **every** capability of the box, and
each tool documents itself — the `initialize` reply carries `instructions` that state what the
wrapper is, the two laws, how to pick a tool, and how to quote a command.

```bash
# 1. handshake — keep the Mcp-Session-Id it answers with
curl -s -X POST localhost:8125/mcp -H 'content-type: application/json' -d '{
  "jsonrpc":"2.0","id":1,"method":"initialize",
  "params":{"protocolVersion":"2025-06-18","clientInfo":{"name":"curl","version":"1"}}}'

# 2. what is on offer (name, description, and an inputSchema with a description per property)
curl -s -X POST localhost:8125/mcp -H 'content-type: application/json' -H 'mcp-session-id: <id>' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# 3. use it
curl -s -X POST localhost:8125/mcp -H 'content-type: application/json' -d '{
  "jsonrpc":"2.0","id":3,"method":"tools/call",
  "params":{"name":"pw_launch","arguments":{"command":"ping -n 4 127.0.0.1","name":"probe"}}}'
```

| Tool | What it does |
| :--- | :--- |
| `pw_health` | liveness + counters + the laws this box keeps |
| `pw_launch` | start a command **or a saved one by name**; every launch option (args, cwd, env, name, tag, shell, bufferLimitChars) |
| `pw_list` | the table, filterable by `life` and `tag` |
| `pw_get` | one record in full, plus its buffer status and stream file |
| `pw_output` | a copy of the captured text — whole, `from`/`limit` ranged, or one `channel` |
| `pw_follow` | collect a live copy until the process ends, `maxChars`, or `timeoutMs` |
| `pw_wait` | block until the life ends and return the exit code |
| `pw_input` | write to the child's stdin |
| `pw_kill` | graceful, then forced tree kill (`force`, `graceMs`) |
| `pw_remove` | kill if alive + forget the record; the life file stays |
| `pw_commands` / `pw_save` / `pw_unsave` | the saved commands in `data.yaml` |

Transport details: `notifications/initialized` answers `202` with no body; replies are JSON, or
SSE frames when the client sends `Accept: text/event-stream`; batches are answered in order;
`initialize` issues `Mcp-Session-Id`; `DELETE /mcp` closes it; `GET /mcp` is a `405` that points
at the SSE endpoint instead. Errors keep their meaning: a **refused tool argument** comes back
as `isError: true` with a message that says what to do, while a protocol problem uses the real
JSON-RPC codes (`-32601` unknown method, `-32602` unknown tool/params, `-32700` parse error).

The process lives are also exposed as **resources** (`resources/list`,
`resources/read` of `process-wrapper://processes/<id>/output`), so a client that prefers
resources over tools can read them that way.

The same tool table is exported as a **registry** — `createPwMcpRegistry({ wrapper, hub,
registryFile })` from the embed entry returns `{ module: 'process-wrapper', list(),
call(name, args) }`: the identical tool objects the module's own `/mcp` serves, ready for
a root (Api_Root) to mount. Same object on both doors — they cannot drift.

## Saved commands (`data.yaml`)

```bash
pw save tick "node -e \"setInterval(()=>console.log('tick'),1000)\"" --desc "a ticker"
pw commands
pw start "python bar.py"   # or launch a saved one by name:
curl -s -X POST localhost:8125/api/processes -d '{"saved":"tick"}'
```

## Notes that will bite otherwise

- **Quote paths with spaces.** `pw start "\"C:\Program Files\nodejs\node.exe\" -e 1"` —
  the command string is split on spaces (quotes are honoured), so an unquoted
  `C:\Program Files\...` is read as two argv entries.
- **`shell: false` by default** — pipes, `>` and `|` need `"shell": true` (or `--shell`).
- **A kill is two-step**: a graceful signal, then a forced tree kill after `--grace-ms`.
  `force: true` skips the wait. On Windows the force step is `taskkill /PID <pid> /T /F`, so
  grandchildren die with the child.
- **Channel offsets are per channel.** `output?channel=stdout&from=100` counts characters of
  *that* channel; `both` reads the file in arrival order. A copy is reported `complete:false`
  when the RAM buffer already shed the front — the life file always has it.
- **`from` means "skip the front", whenever the front arrives.** A copy asked to start at N
  skips the text before N in the frame it was asked about — the text that already exists AND
  the text that arrives later. So a reader can resume exactly where it stopped with no
  duplicate and no gap (`from` = the `to` of the previous read, or the previous chunk's
  `fileFrom` + its length for a live SSE copy, whose chunk frames carry `fileFrom` too).
- **`GET /api/processes/:id/stream` copies, it does not consume**: closing your copy never
  touches the process or anybody else's copy.
- **A launch answers immediately.** `POST /api/processes` returns the record as it is at that
  instant (`running` with a `pid`, or `starting` when the spawn result has not landed yet).
  A command that cannot start turns `failed` a moment later with the reason in `error` — read
  `GET /api/processes/:id` (or open the stream) if you need the verdict, and the table always
  tells the truth afterwards.

## Self-check

```
npm test        # build → typecheck → the gate (423 checks, exits non-zero if any fail)
```

Every module ends with its own `runTests()` (kept, commented out of the module body) and the
gate collects them, per module, in one report. The checks spawn real processes, bind real
ports and make real HTTP calls — nothing here is a mock. The GUI's DOM half is verified
against the live page (the element ids the module wires are the ones `public/index.html`
carries, and the gate asserts they are all there).

## The console window (the many-to-one)

ProcessWrapper is launched **once**. Everything else arrives as **events** — the console
events carried by an Event_Handler instance embedded in this thread (`consoleEvents.ts`).
Any hand can fire them: the window's own add bar, the API, a script, a command-line arg,
a curl. The trigger only **fills the fields and fires**; the wrapper acts.

- **`add Process Console Display`** — fields: `name` · `provider.launch` (the wiring to
  connect — the Service Provider block; or a plain `command`) · `args` · `cwd` · `env` ·
  `shell`. The wrapper launches it through its own machinery and the console becomes a
  display. No pre-decisions: whatever the registration supplies lands in the launch; what
  is missing falls back to the lean defaults (name `console-N`; cwd = the wrapper's own
  folder). Extras ride along — kept visible in the outcome event, never dropped.
- **`kill Process Console Display`** — fields: `id | name` · `force` · `graceMs`.
  Graceful ask first; the same door escalates to force only if the ask did not land.
- **`note System Drain`** — fields: `name` · `pid` · `cpuPeak` · `diskPeakMBs` · `samples` ·
  `unexpected`. Fired by the drain watch itself the moment something drains the machine;
  any hand may fire one (a script, a curl). The event log keeps the receipt either way.

All three events log to `data/console-events.log` with the same outcome wrap every
Event_Handler writes (`<name>.result`, errors as `<name>.error`). The palette and the
rolling log are served at the door:

    GET  /api/events            the palette (what this wrapper can be asked)
    POST /api/events/trigger    {"name":"add Process Console Display","payload":{...}}   202, fire-and-forget
    GET  /api/events/log?limit  the rolling record

**The window** (`window/main.cjs`, an electron host; its page is `/window.html` served by
the door — so the window is just another hand on the same events):

- one **tab per console display** — anything the door runs with tag `console`
- the first tab is the wrapper itself (live counts + the palette)
- **minimize** parks a display in the native **Window** menu (the pull-down along the top
  holds the hidden ones); the process lives on; one click restores it
- a tab's **x** fires the **kill event** — a process here ends by graceful exit or by that
  event, never another way
- the footer bar is one more hand: fill name / command / cwd, fire, watch the tab appear

Run it (needs electron; on the 980ti node: `C:\Hydra\electron\electron.exe`):

    electron.exe window/main.cjs          (PW_WINDOW_PORT to point at another door)



## The drain watch (why was this machine slow?)

The wrapper can watch the machine it lives on. Armed by default in `main()` (`--no-watch`
disarms), it launches one more child through its own table — the **sampler**
(`scripts/system-sampler.ps1`, tag `watch`, name `system-watch`): every 20 seconds one JSON
line of total CPU, the top CPU processes, per-drive disk activity and the top IO processes.
The watch reads those lines and keeps **receipts**:

- a small daily log, `data/watch/watch-YYYYMMDD.log` — **events only, one line each**: a
  **drain** (a process, or the machine total, held above threshold for 2+ samples), an
  **episode-end** (it stopped — with the peak), a **new** name (first seen), and
  **watch-notes** (sampler restarts). Samples never enter this log — the sampler's own life
  file (`data/streams/<id>.log`) keeps them, per the first law.
- a **`note System Drain` event** for every drain — the palette logs the receipt, the
  console prints it, the window hears it. "It was slow at 09:41" becomes a grep.
- `data/watch/expected.txt` — the KNOWN list (one process name per line; `#` comments).
  A name on it is never tagged `UNEXPECTED`; a name off it is only ever **tagged** — the
  watch logs every drain either way. A tool, not a rule: absence tags a line, it never
  hides one.

Read it by hand: run `watch-report.cmd` at the module root — today's events, then the three
previous days, then the expected list.

CPU and hard disks only — the GPU is not the wrapper's business. Thresholds live at the
top of `systemWatch.ts` (process at or above 20% cpu or 20 MB/s io, machine at or above
60% cpu total, 2-sample sustain). Everything is one `createSystemWatch({...})` call away
for another thread.
