# State — the generic retainer and retriever

**Register ANY object under a dotted-path name. Pull it back — whole, or the part past the
marks the requester carries. Discover what is held. Drop it.** The tree falls straight out
of the name (`Root.Server.ClientName`); a pull resolves by the shortest unique suffix (the
leaf works when it is unique). Entries describe THEMSELVES; the module relays and decides
nothing.

It is generic — 0 pre-conceived definitions, no project words inside. It stands alone, and
it is the piece Hydra (v2) will use as its State later — **by registration, never by module
knowledge**. The module doesn't know any of that.

## The laws kept here

1. **GENERIC** — the registry boots BLANK. It holds whatever is handed to it, in the
   registrant's own shape. Nothing is defined in advance; nothing persists.
2. **ENTRIES DESCRIBE THEMSELVES** — a lazy liveness check (`alive`) · a pull recipe
   (`pull` — how the entry answers, e.g. a live source) · per-element serving flags
   (`serving: { log: 'delta' }`) · a render map (`render`) · an update contract (`update`).
   The module reads only what it must, understands none of it.
3. **THE REQUESTER CARRIES THE MARK** — State remembers nobody. A new / unknown / stale
   request gets the **FULL** state; a fresh mark plus an element flagged *"to be delta
   served"* gets the **DELTA** past the mark. The mark is element-natural (a log marks by
   position: "I hold lines 1–812"); a string serves by **lines**, an array by **items**.
4. **NAMES ARE PATHS** — dotted paths; a pull for `ClientName` need not carry
   `Root.Server.ClientName`. Ambiguity is refused **with the candidates**.
5. **A REGISTRATION LIVES AS LONG AS ITS REGISTRANT** — a dead registrant pops; absence
   reads as absence. `drop(name)` is the explicit death hand.
6. **NO CLOCKS** — refresh is two-sided: the source supplies a speed, the requester
   (render) has its own. **State controls neither and runs no clock.**

## Layout

```
State/
├── State_module.js          ← THE ONE FILE LOADED (embed entry for another code thread)
├── package.json             ← scripts: build · typecheck · selftest · test · docs · start
├── tsconfig.json            ← strict, ES2022, NodeNext
├── scripts/build-docs.cjs   ← assembles Docs/index.html (purpose + every .d.ts contract)
├── Docs/                    ← THE ONE FILE an agent reads (+ Docs/types/*.d.ts)
└── public/
    ├── index.html           ← the view page
    ├── css/gui.css
    └── ts/                  ← sources (compiled to public/js/ by esbuild)
        ├── stateRegistry.ts ← THE CORE — register · pull · discover · drop · watch
        ├── mcpTools.ts      ← the agent face as a registry (state_list/pull/register/drop)
        ├── mcpServer.ts     ← MCP-over-HTTP (JSON-RPC, sessions) — serves any registry
        ├── apiServer.ts     ← /health · /api/state* · the SSE change feed (+ mounts MCP)
        ├── staticFiles.ts   ← serves public/ on the same port
        ├── client.ts        ← the ES-module client + SSE reader
        ├── browser/gui.ts   ← the page (pure renderers + mount())
        ├── main.ts          ← the entry point (flags/env → registry + API)
        └── selftest.ts      ← THE GATE — runs every module's own runTests
```

## Run it

```bash
npm install
npm test            # the gate: build → typecheck → selftest (118 asserts)
npm start           # GUI + API + MCP on http://127.0.0.1:8127
node State_module.js   # the embed entry's own check (12 asserts)
npm run docs        # regenerate Docs/index.html
```

Flags: `--port` (default 8127) · `--host` (default 127.0.0.1) · `--token` (guard `/api`
and `/mcp` with `x-state-token`). Env: `STATE_PORT`, `STATE_HOST`, `STATE_TOKEN` —
a flag beats the environment. **Nothing persists**: the registry boots blank; it holds
what it is handed, for as long as it is handed.

## Walk the door

```bash
# register anything
curl -X POST localhost:8127/api/state/register -H 'content-type: application/json' \
  -d '{"name":"Root.Server.ClientName","content":{"ip":"192.168.1.100"}}'

# discover (shape is listed — contents are pulled, never embedded)
curl localhost:8127/api/state?q=Root

# pull by leaf — no need for the whole path
curl 'localhost:8127/api/state/pull?name=ClientName'

# a delta-flagged element: first read = FULL + fresh marks, next = the delta past them
curl -X POST localhost:8127/api/state/register -H 'content-type: application/json' \
  -d '{"name":"Demo.Log","content":{"log":"l1\nl2\nl3"},"serving":{"log":"delta"}}'
curl 'localhost:8127/api/state/pull?name=Demo.Log'                    # full, marks {log:3}
curl 'localhost:8127/api/state/pull?name=Demo.Log&marks=%7B%22log%22%3A2%7D'   # delta "l3"

# drop (explicit death hand; a dead registrant pops on its own)
curl -X POST localhost:8127/api/state/drop -H 'content-type: application/json' \
  -d '{"name":"ClientName"}'
```

Routes: `GET /health` · `GET /api/state?q=` · `GET /api/state/pull?name=&marks=` ·
`POST /api/state/register` · `POST /api/state/drop` · `GET /api/state/stream` (SSE change
feed) · `POST /mcp` (agents) · `GET /` (the page). Errors answer
`{"error":{"code","message"}}` with real statuses: `bad_json` 400 · `bad_name` 400 ·
`no_such_entry` 404 · `ambiguous` 409 (the candidates ride in the message) ·
`unauthorized` 401 · `no_route` 404.

## Agents — MCP

`POST /mcp` speaks MCP-over-HTTP. Tools: **`state_list`** (the active set — shape, never
contents) · **`state_pull`** (`{ name, marks? }` — carry your marks; flagged elements answer
as deltas) · **`state_register`** (`{ name, content, serving?, render?, update? }`) ·
**`state_drop`** (`{ name }`). Over the wire the standing is JSON only — liveness checks
and pull recipes ride on in-process registrations.

## Using it as a module

```js
import { createModule, startModule } from './State_module.js';

const m = createModule({});                              // boots blank — the host registers
m.state.register('Root.Name', { ip: '10.0.0.1' });
const a = await m.state.pull('Name');                    // a pull resolves by leaf
a.content.ip;                                            // '10.0.0.1'   (answer is a clone)

// delta-flag an element — the requester carries the mark:
m.state.register('Log.Thing', { log: 'l1\nl2\nl3' }, { serving: { log: 'delta' } });
const full = await m.state.pull('Log.Thing');            // { full: true, marks: { log: 3 } }
const part = await m.state.pull('Log.Thing', { marks: full.marks });   // { full: false }

// a live source answers with its own hand; flags still apply to what it returns:
m.state.register('Live.Thing', {}, { pull: () => ({ log: currentText() }), serving: { log: 'delta' } });

// nesting — by registration, never by module knowledge:
m.state.register('Node.A', otherState);                  // the entry IS a registry (it has .pull);
                                                         // the parent asks it for the leaf ('A') and
                                                         // the child answers for its own contents
m.state.register('Node.B', {}, { pull: async (r) =>       // …or relay explicitly
  shaped((await otherState.pull('Inner', { marks: r.marks })).content) });

// liveness — a lazy check; a dead registrant pops (absence reads as absence):
m.state.register('Ephemeral.Thing', { x: 1 }, { alive: () => stillThere() });
m.state.watch((change) => console.log(change.kind, change.path));  // registered|updated|dropped

const s = await startModule({ port: 0 });                // its own little door (port 0 = OS picks)
s.url;                                                   // http://127.0.0.1:<port>
await s.stop();
```

## Notes that will bite otherwise

- **Pulls answer clones** (data rides alone); odd handles ride by hand.
- **A pull by a bare leaf works only while unique** — ambiguity is refused *with the
  candidates*; extend the suffix until only one answers.
- **String elements serve by lines, arrays by items** — the mark is a position count.
- **The same path re-registered = last hand-in wins**; an identical hand-in is a no-op
  (no event, timestamps kept).
- **Nothing is embedded**: a listing carries the SHAPE; contents only ever answer a pull.
- `get`-style poking of other threads' data is out of scope by design — this is the
  registry the threads SHARE, not a window into someone's heap.

## Self-check

```bash
npm test        # 118 asserts across 8 modules, the embed entry adds 12 (node State_module.js)
```

Every module carries its own `runTests()`; `selftest.ts` is the one hand that runs them
all — GREEN/RED + exit code. The Docs page (`Docs/index.html`) carries the purpose + the
`.d.ts` contract of every file, generated from the sources.
