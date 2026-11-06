# Basic_App — the service shelf

**One small app a newbie can drive: it lists the available services, shows the viewed
service's offer, gathers what that service needs, and runs it — ONE at a time, no queue,
busy or not.** Looking around is always free; while something runs, the buttons that would
harm the run go INACTIVE (never hidden). Past a successful launch the app only watches —
"The Basic way."

It is GENERIC: it loads "available services" having no idea what they are. Every service is
a definition on the shelf; Basic_App is the INSTANCE.

## The wire — all six shelf modules, tried for real

| module | how Basic_App uses it | where |
| :--- | :--- | :--- |
| **Services** | the listing, the definition, the `ad` + `inputs` pages (they are served, never parsed) | door `:8128` |
| **ResourceManager** | `refresh` (the poll) → `book` at run start → `pop` at the end; the gpu is picked from the Register's own names | door `:8129` |
| **ProcessWrapper** | `launch` (resolved command, tag `basic`) · output copies (progress) · `kill` (Stop) · the life-watch | door `:8125` |
| **State** | variable storage: `Basic.Run.<name>` (running → ended exit code), `Basic.Last`, and the tab visual `Basic` (highlighted / solid / flashing) | door `:8127` |
| **Event_Handler** | in-process in the shell: wrapper clicks + `basic.run-started` / `basic.run-ended` all land in one rolling log | `data/events.log` |
| **Electron_Wrapper** | the shell: one full-window tab named `Basic` wrapped around the app's own address; it also pulls that tab's visual from the State door — the tab glows while a run is live | `electron/main.cjs` |

The run chain (the instance's brain, all in `public/ts/runLogic.ts` + `basicServer.ts`):
read the definition → fill + check required inputs → deal with lazy outputs (never the same
filename twice) → poll RM and pick a gpu → book → resolve `{{tokens}}` → launch at PW →
State as variable storage → watch the life → pop the booking → fire the events. Where a
seam is clumsy it shows here first — this file is the wiring map (and the parts worth
lifting into a future Scheduler live in `runLogic.ts` alone).

## Run it

```bash
# the app's own door (UI + /api/basic) — doors are pointed at, never started by the app:
node public/js/main.js                  # http://127.0.0.1:8130
# the shell (needs an electron binary on PATH or ELECTRON override):
electron electron/main.cjs              # wraps localhost:8130 in a full-window tab

# build · typecheck · the gate
esbuild 'public/ts/**/*.ts' --outdir=public/js --format=esm --platform=neutral --target=es2022 --sourcemap
tsc --noEmit
node public/js/selftest.js              # GREEN/RED + exit code
node Basic_App_module.js                # the embed entry's own check
```

Flags: `--port` (8130) · `--host` · `--services` · `--pw` · `--rm` · `--state`
(env: `BASIC_PORT`, `BASIC_SERVICES_URL`, `BASIC_PW_URL`, `BASIC_RM_URL`, `BASIC_STATE_URL`).

## The app's own API

| Method + path | What it does |
| :--- | :--- |
| `GET /api/basic/services` | the shelf, from the Services door |
| `GET /api/basic/services/:name` | one definition |
| `GET /api/basic/services/:name/ad` · `/inputs` | the service's two pages (html passthrough) |
| `POST /api/basic/run` | `{name, values}` → book → resolve → launch; refusals carry the reason (`busy`, `missing_inputs`, `book_refused` + blockers, `no_gpu`, `unresolved_tokens`) |
| `GET /api/basic/state` | `{busy, run}` — the pane's truth |
| `GET /api/basic/progress?from=` | the next slice of the run's output (`{from, text}`) |
| `POST /api/basic/stop` | kill the run; the watcher settles everything |
| `POST /api/basic/gui` | follow the service's own gui (launched through the wrapper, tag `basic-gui`) |

## Rules kept here (the operator's rulings)

- **One at a time, no queue** — busy or not; a second run answers `busy` with the holder.
- **Remembers last inputs per service** (browser storage); a field marked `muted` always
  resets to its default — it is the defaulted hand.
- **Output path is an input with a default**; if the filename is already taken the instance
  keeps it fresh (`out.png` → `out-2.png`).
- **The ad swaps on hover / arrow-key highlight**; "Prepare this serve" opens the inputs
  page + the form built from the definition's own data.
- **Follow-gui button only when the service provides its own gui**; after a successful
  launch the app does not care what the user does there.
- **The busy strip + Stop live in the header**; the run's progress copies into the run pane
  while it lives.

## Status — v0.1.0 (2026-09-25)

- Gate: 43 asserts across doors · runLogic · gui · basicServer — GREEN.
- Live smoke on Main (2026-09-25): full wire against the real doors — booking on the real
  GTX 1650 while running, progress copying tick by tick, settle-by-itself, booking popped,
  State variables + tab visual written, PW stream file complete.
- Known seams (recorded on purpose — better piece connections wanted): RM's first poll is
  slow (nvidia-smi + driver read; warm it before showing run times), and the Services door
  caches its folder at boot (bounce the door after adding a service file).
- The shell (electron) is wired but was not launched on Main (no electron binary there);
  first shell run belongs to the node setup.
