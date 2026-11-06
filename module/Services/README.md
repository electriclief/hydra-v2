# Services

**The definitions of a run.** One tiny `.js` data file per service — the elaborate object:
advert · provider · variables (init · input · files) · modes (each with its models, needs,
karma weight and **install** — where the version dance for older GPU cards lives) · needs ·
output · children · update · **pages** (the TWO the service produces: **ad** — the sell sheet; **inputs** —
the way in, which gathers the required inputs and carries progress during the run) · **progress** (the
declared how-to — the instance tracks and shows it) · **gui** (its own gui, when it has one).

**Nothing here runs.** Services *declares*; the Scheduler books and runs, later. State is the
ground truth of a run; the Resource Manager books the resources; this module only carries the
definitions — clean, validated, and easy to move between nodes.

> Operator's words, the shape it all came from: *"a service is a defined 'run' of an app with
> defined variables"*, *"Service Provider: the app that runs it"*, *"Services has NOTHING to do
> with actually being run... that is done by a future module 'Scheduler'"*.

## The three laws this module holds

1. **ONE FILE PER SERVICE — the folder IS the catalog.** A service is one `.js` file under
   `services/`. Drop a file in, reload, it is offered. Nothing else is a catalog.
2. **DATA, NOT CODE.** A service file is a single literal assignment; it is loaded as DATA and
   never executed. The ladder: comments may lead, then *exactly one* `module.exports = <literal>`;
   code tokens are refused outright; the literal is evaluated in an **empty sandbox** (no
   `require`, no `process`, no filesystem, no network, code generation off, 2 s timeout);
   the result is scanned deep (a function value anywhere is a refusal); then the schema runs.
   Heavy items travel by **link** (`{ path · sha256 · source { magnet · peer } }`), never inside
   the file; small bits (an ad thumbnail) may inline as base64; the pages ride as strings.
3. **THE INSTALL FACE CARRIES THE VERSION DANCE.** Older GPU cards are first-class: a mode
   declares its `install.pins` (python · cuda · torch — *"the version dance"*: find the python
   that still has wheels for the cuda the old card needs) and its `sm` note (llama.cpp builds
   per `sm_XX`; the 980ti's fast path was a hand-made sm_52 build). Updates move the dance —
   re-check the pins when you update.

## Layout

```
Services/
  Services_module.js        the embed entry a host loads (createModule · startModule)
  README.md                 this file
  package.json · tsconfig.json
  scripts/build-docs.cjs    npm run docs → Docs/index.html (generated, never hand-edited)
  services/                 THE CATALOG — one .js per service (shipped starters live here)
  public/
    index.html · css/gui.css
    ts/                     sources — one module per concern, each with its own runTests
    js/                     compiled output (esbuild, no bundling)
  Docs/                     generated documentation
```

## Core Modules

| Module File | Reason / Functionality |
| :--- | :--- |
| `serviceSchema.ts` | THE OBJECT — the shape of a service definition (advert · provider · variables · modes · needs · output · children · update · pages · progress · gui) + `validateService()`. The core is checked hard; everything else passes through untouched — nothing frozen. |
| `serviceFile.ts` | Reading ONE service file as DATA, never executing it: shape gate · one-assignment rule · code-token gate · empty vm sandbox · deep function scan · schema. A bad file is refused with a reason, never a crash. |
| `serviceCatalog.ts` | The folder IS the catalog: scan → load → validate → list (shapes only) · get (the whole definition) · ad + inputs (the maker's two pages) · reload · refusals. Duplicate names refused on both sides. |
| `mcpTools.ts` | The agent face as a REGISTRY (list + call): `services_list` · `services_get` · `services_ad` · `services_inputs` · `services_reload` · `services_validate`. Api_Root mounts the SAME object later — they cannot drift. |
| `mcpServer.ts` | MCP over HTTP: JSON-RPC, sessions, SSE framing, notifications 202, `-32601`/`-32602`, refusals as `isError: true`. |
| `apiServer.ts` | The HTTP face: `/health` · `/api/services` · `/api/services/:name` · `/api/services/:name/ad` · `/api/services/:name/inputs` · `POST /api/services/reload` · `/api/services/validate` (+ static + `/mcp`). Optional shared token. |
| `staticFiles.ts` | Serves `public/` — MIME map, index fallback, traversal guard, a 404 that names the API. Static files are not actions: served without the token. |
| `client.ts` | The ES-module client (Node or browser) with the server's own error codes. The page imports the SAME client the tests use — no drift. |
| `browser/gui.ts` | The page: the catalog as a table (name · provider · modes · karma · sound or refused), a detail pane (the whole definition + links to both pages), filter, reload. |
| `main.ts` | Boot on **8128**: flags > `SERVICES_*` env > defaults; the banner names every door. |
| `selftest.ts` | THE GATE: every module's own `runTests`, one command (`npm run selftest`), assertion-counted, exit code — plus `tsc --noEmit` beside it. |

## Quick start

```bash
npm install
npm run build          # esbuild, no bundling — the ES module boundaries survive
npm run typecheck      # tsc --noEmit (esbuild does not type-check)
npm run selftest       # every module's own self-check — the gate
npm start              # the door on http://127.0.0.1:8128  (--port / SERVICES_PORT to move)
npm run docs           # regenerate Docs/index.html from the headers + .d.ts contracts
```

## The doors

```
GET  /health                          who this is, how many services are sound
GET  /api/services                    the listing (shapes: name · provider · modes · karma · ok)
GET  /api/services/:name              the WHOLE definition (JSON) + warnings
GET  /api/services/:name/ad            the ad page (the sell sheet), as text/html
GET  /api/services/:name/inputs        the inputs page (the way in), as text/html
POST /api/services/reload             re-scan the folder (the folder IS the catalog)
GET  /api/services/validate            the report: every definition, errors and warnings
POST /mcp                             services_list · services_get · services_ad · services_inputs · services_reload · services_validate
GET  /                                the page (the catalog, its details, its refusals)
```

A service name must not be `reload` or `validate` — those two words under `/api/services/` are routes.

## Writing a service file

```js
// my-service — comments may lead; the single data assignment follows.
module.exports = {
  name: 'my-service',                       // unique in the catalog
  advert: { what: 'one line', time: 'from history — unknown until then', karma: 3 },
  provider: { name: 'the app', repo: 'https://…', launch: 'app --flag "{{input}}"', update: 'the declared update' },
  variables: {
    init:  [{ name: 'exeDir', type: 'text', default: 'C:/services/app' }],   // install facts
    input: [{ name: 'prompt', type: 'textarea', required: true }],           // per request
    files: [{ name: 'workflow', kind: 'json', note: 'a slot plugs a FILE — or a SERVICE that produces it' }],
  },
  modes: [{ name: 'cuda-old-cards',
            fits: { sm: '50..61', note: 'old cards are first-class' },
            models: [{ url: 'https://…', note: 'links only — Hydra will mirror and pin' }],
            install: { pins: { python: '3.10', cuda: '11.8', torch: '2.5.1+cu118' },
                       sm: '52',
                       steps: ['the dance, in order'], fallback: ['…'] } }],
  needs: { gpu: true, vramGb: 6, ramMb: 8000, cores: 2, diskGb: 5 },
  output: { kind: 'file', location: 'where it lands' },
  update: { command: 'git pull && rebuild', note: 'WHEN is the user\'s and Echidna\'s call — the how is here' },
  pages: { ad: `<h1>advert</h1><p>the sell sheet: what it does, why you want it</p>`,
           inputs: `<h1>the way in</h1><p>gathers the required inputs; the progress rides here during the run</p>` },
  progress: { how: 'the run prints "step N of M"', source: 'stdout' },
  gui: { kind: 'url', value: 'http://127.0.0.1:8188', note: 'its own gui, when it has one — a button follows it' },
};
```

Format laws (enforced by the loader): comments may lead, then exactly **one**
`module.exports = <literal>;` · no `${` (page scripts use string concatenation) · no nested
backticks inside a page · no `require(` · `import(` · `eval(` · `Function(` · `globalThis` ·
`process.env` · `child_process` anywhere · heavy artifacts by link, small bits as base64.

## The shipped starters (also the testing material)

| Service file | Provider | Carries |
| :--- | :--- | :--- |
| `services/chat.js` | llama.cpp | **THE EXEMPLAR — designed, not generated**: one chat · several brains (the brains menu with spans and personalities), sparkle that stays inside the laws, and the closing permission slip — "your service does not have to look like anything anyone has seen" |
| `services/llama-chat.js` | llama.cpp | the sm_XX story (cuda-old-cards mode, the trial notes), the nightly-tag.txt install trap, CPU/vulkan modes |
| `services/image-gen.js` | stable-diffusion.cpp | the krea2 flow, pinned one-line command, aspect presets, self-rolling seed |
| `services/comfyui-workflow.js` | ComfyUI | THE VERSION DANCE (python · cuda · torch, in order), workflow-as-contract, update method |
| `services/wan2gp-video.js` | Wan2GP | low-VRAM quantized video, first-frame file slot (a file OR a producing service) |
| `services/hermes-agent-run.js` | hermes-agent.exe | yolo desktop vs one-prompt runs, profile/model under the service, visible runs |

## Using it as a module

```js
import { createModule, startModule } from './Services_module.js';

const pieces = createModule({ dir: 'C:/hydra/services' });   // catalog + registry, no port
const running = await startModule({ dir: '…', port: 0 });    // its own little door
await running.stop();
```

A host (Api_Root, later) mounts the SAME registry object the module's own `/mcp` mounts —
they cannot drift, because it is literally the same object.

## Honest notes (v0.2 — liquid)

- **v0.2 — the two pages.** A service PRODUCES two pages: `pages.ad` (the sell sheet) and `pages.inputs`
  (the way in — it gathers the required inputs, and the progress rides on it during the run). `progress`
  and `gui` are declared on the definition; the INSTANCE (Basic_App) tracks, shows, and follows them.
  The retired single `page` still loads — as a warning, not an error.
- **Nothing is frozen.** The object is v0.2: the core is validated hard; unknown fields pass
  through untouched. Fields will grow as the network grows.
- **Karma** is a weight on the definition; the ledger does not exist yet — it will live
  outside this module. Free at zero; the effect is queue priority; paid to the provider after use.
- **LAN vs Broker** is *not* on the definition — it is the node/user runtime's business
  (keep serving your own project; keep it off the broker; the definition never changes).
- **Running, booking, state injection** belong to the Scheduler / Resource Manager / State —
  later modules. This one declares, and only declares.
- The early trial that shaped `llama-chat` and the old-card modes (980ti, 2026-09-23):
  installed via the nightly tag (the release named "latest" holds only `nightly-tag.txt`),
  generated end-to-end; vulkan was slow warm on that card, CPU faster, sm_52 the fast path.

## Authoring a hero image (the ad page's one picture)

A page may carry ONE base64 `<img>` — no external references. Two authoring scripts keep
that cheap and honest (they are BUILD tools; the module never imports them):

```bash
# 1) shoot big and long on a render node, then crop/scale to the exact hero frame
python scripts/make-hero.py big.png hero.jpg --w 896 --h 640 --q 85
#    prints raw + embedded size and enforces the budget (WARN 250 KB, REFUSE 500 KB)

# 2) encode it into the one line a service file may carry
node scripts/embed-image.cjs hero.jpg HERO_CHAT
#    prints: dimensions, sizes, the `const`, the <img> tag, and a budget verdict
```

**Budget (why it exists):** every service file is loaded into memory as DATA. A hero is
~28–100 KB base64 at 896×640 q85 — fine. A raw 1024×768 PNG is 1.7 MB → 2.3 MB base64 —
that is a RAM bill paid by EVERY node that loads the catalog.

**The recipe** (operator, 2026-10-18): render bigger and longer than the page needs
(e.g. 1024×768 @ 25 steps), then downscale/crop. Measured on .123: 768×512 @ 10 steps ≈ 25 s,
1024×768 @ 25 steps ≈ 268 s — cost grows faster than pixels × steps, so shoot big for the
heroes you keep, small for the drafts you throw away.

## Self-check

```bash
npm test               # build + typecheck + the gate
node Services_module.js  # the embed entry's own direct-run self-check (real port, real file)
```

Every module carries its own `runTests()` — the modular law. The gate counts assertions and
exits non-zero on any failure; `tsc --noEmit` runs beside it because esbuild does not type-check.
