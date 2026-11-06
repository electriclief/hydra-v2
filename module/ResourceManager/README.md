# Resource Manager — the register

The sixth module on the shelf (after ProcessWrapper · Event_Handler · State ·
Electron_Wrapper · Services). A per-node, **voluntary, label-only** resource
register: it READS what this machine has, and it keeps **BOOKINGS** — what a run
holds. It is **not enforcement**: nothing here locks anything at the OS, nothing
schedules, nothing queues. "A tool to help manage resources."

> Operator rulings (talk rounds 1–5, 2026-09-24):
> - **No internal logic.** Its ONE rule: it won't allow **double booking** —
>   one app per GPU. The scheduler (later) does the thinking.
> - **Poll and book are independent** operations. Scheduling and ordering does
>   not happen here. No queue, no ETAs, no future orders.
> - A booking always **sources from a request to run a service**; after
>   assignment the expected next step is the launch via **ProcessWrapper**.
> - Paths are **not locks** — parallel agents book the folders they work in so
>   they don't step on each other. A booked folder covers its **subtree**
>   (children assumed).
> - Cores / RAM / disk book **by amount**; a GPU is **whole + pinned**.

## Run it

```
npm install          # once (or copy a sibling module's node_modules)
npm start            # the door on http://127.0.0.1:8129
npm test             # build + typecheck + the whole self-check gate
```

If `npm` feels stuck (on this box it can hang in a git-bash/MSYS shell even
after printing), the direct commands always work:
```
node public/js/main.js                       # start
node public/js/selftest.js                   # the gate, one command
node_modules/.bin/esbuild public/ts/*.ts public/ts/browser/*.ts --outdir=public/js --format=esm --platform=node --target=node20 --sourcemap
node node_modules/typescript/bin/tsc --noEmit
```

Flags > environment (`RM_*`) > defaults:
`--port 8129` · `--host 127.0.0.1` · `--data ./data` (bookings live in
`data/bookings.json`) · `--shares <file>` (declared shared folders, default
`<data>/shares.json`) · `--token <s>` (guards /api/* and /mcp: `x-rm-token`
header or `?token=`) · `--quiet` · `--help`.

## The four verbs

| verb | what it does |
|---|---|
| **POLL** `GET /api/resources` | Pure read: cpu (cores · load) · gpus (name · vram truth · observed gpu-side processes) · ram · disks · Hydra shared folders · **every current booking**. Asking holds nothing and remembers nothing. |
| **BOOK** `POST /api/book` | The ONE write. The caller passes the **chosen** resources; the book lands **whole** or is refused **whole** — the refusal carries the **wait info** (what is in the way, held by which service, since when). |
| **POP** `POST /api/bookings/:id/pop` | The normal exit — the run ended, the hold lifts. |
| **CLEAR** `POST /api/bookings/:id/clear` | The manual exit — a corpse hold, a stale claim, an operator's hand. |

`GET /health` · `GET /api/bookings[?include=ended]` · `GET /api/bookings/:id` ·
`POST /api/resources/refresh` (a forced re-read).

### The book request

```json
{ "service": "image-gen", "mode": "krea2", "gpu": "AMD Radeon RX 6800",
  "cores": 4, "ramMb": 8000, "diskMb": 2000,
  "paths": ["C:\\work\\myproject"],
  "expected": "~20 min", "note": "night batch" }
```
Only `service` is required — and at least one resource to hold. `expected` is
**recorded, never computed with** (the scheduler's own decision; leave empty when
unknown). `gpu` is a name exactly as the poll shows it.

A refusal is an **answer**, not an HTTP error (200 + `ok:false`):

```json
{ "ok": false,
  "error": { "code": "double_booked",
             "message": "gpu AMD Radeon RX 6800 is booked by image-gen (since …)",
             "blockers": [ { "kind": "gpu", "detail": "…",
                             "heldBy": { "id": "bk-…", "service": "image-gen", "since": "…" } } ] } }
```
Codes: `double_booked` (someone holds it) · `missing_resource` (this node does not
have it — e.g. a GPU that isn't here) · `invalid_book` (malformed) ·
`no_such_booking`.

## The agent face (MCP on the same port)

`POST /mcp` — `rm_resources` (the poll) · `rm_book` · `rm_bookings` · `rm_pop` ·
`rm_clear`. The registry (`public/ts/mcpTools.ts`) is a plain object — Api_Root
will mount the SAME one later; they cannot drift.

## Reads, honestly

- **VRAM truth** — `nvidia-smi` when present, else the driver registry
  `qwMemorySize`, else AdapterRAM (Windows UInt32 caps it at 4095 MB — the RX
  6800 bug), else `unknown` with the source named on every row.
- **The observed row** — GPU-side processes nobody booked (a miner, an outside
  llama) are **visible, never blocking**. Information only; the register answers
  from bookings.
- **Shared folders** are a **declared list** (`data/shares.json` — strings or
  `{label, path}`). The register reads each one's existence and its volume's
  space; it does not create or manage them. "Hydra should have shared folders on
  each node if the hard drive space allows" — that's all this is.
- A failed read degrades to a `notes` entry, never a throw. CPU/RAM always answer
  (they come from the machine itself).

## Files

```
ResourceManager_module.js   the embed entry (createModule · startModule · self-check)
public/ts/resourceSchema.ts the vocabulary: reads · booking · outcomes · path overlap
public/ts/resourceRead.ts   the machine reader (one PowerShell pass; vram truth)
public/ts/bookingStore.ts   THE REGISTER (data/bookings.json; book/pop/clear)
public/ts/mcpTools.ts       the agent face as a registry
public/ts/mcpServer.ts      MCP-over-HTTP (sessions · SSE · JSON-RPC)
public/ts/apiServer.ts      /health · /api/* · static · /mcp on one port
public/ts/client.ts         the ES-module client (page + tests share it)
public/ts/browser/gui.ts    the page: the machine · the register · the book form
public/ts/main.ts           boot (flags > RM_* env > defaults)
public/ts/selftest.ts       THE GATE — every module's own self-check, one command
```

Heritage: V1's `client/main/modules/resources` (fresh-on-boot manifest, gpusBusy
process occupancy, the VRAM fixes). The read survives; the gate became
information — this register is voluntary all the way.
