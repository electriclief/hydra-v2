# SessionDiary — the Hermes session wrapper

Every Hermes Agent session, written as a diary entry you can open by double-clicking a file: what
was asked, what actually ran, what changed on disk, where it ended. Then the two things a diary
alone cannot do — **ask a dead session a question** through the deepseek agent, and **fork or
restart** it from the same page.

It is a Hydra V2 door (port **8134**), and it is also just a folder of HTML. The site works with
the door down; the buttons do not.

```
C:\AI\hydra-local\module\SessionDiary\
  site\read_dir_indexer.html     ← open this. all sessions, searchable, filterable
  site\session_<ref>.html        ← one page per session
  site\custom.css, custom.js     ← the two shared assets
  site\data\index.json           ← the machine-readable index (agent entry point)
  site\data\sessions\<ref>.json  ← lean per-session facts, no HTML
  data\diaries.json              ← the prose diaries and the seances (yours, editable)
  data\backups\state-*.db        ← taken before the first fork of an hour
  public\ts\                     ← sources (edit these, never public\js)
```

## Run it

```
cd C:\AI\hydra-local\module\SessionDiary
node public\js\main.js                 # build + serve on 127.0.0.1:8134
node public\js\main.js --once          # build the site and exit
node public\js\main.js --scan 60       # rebuild every 60s while serving
node public\js\main.js --db <path>     # read a different state.db
```

Hydra raises it automatically (`Basic_App/electron/main.cjs` DOOR_TABLE) and the window shows it as
the **Diaries** tab. Logs land in the Process tab like every other door.

## What is on a page

- **What was done** — the LLM diary if one exists, otherwise the deterministic card (free, instant,
  written for every session on every build).
- **The ask / Where it ended** — first real user turn and the last assistant turn. Hermes' injected
  turns (compaction, handoff, background notifications) are skipped when picking the ask.
- **Shortcuts** — copy-paste lines, not links: `hermes --resume <id>`, `hermes -c "<title>"`,
  `hermes sessions export … --format md|html`, plus the ask/fork API calls.
- **Talk to the dead** — a question box, filed answers, and the two session buttons.
- **Evidence** — duration, turns, tokens, cost, files touched (from tool arguments), commands run,
  tool histogram, cwd, git branch, lineage.
- **Transcript** — every turn, tool output trimmed and collapsed.

## API (the agent's entry point)

```
GET  /health
GET  /api/sessions?q=ssh&source=cli&quiet=1&limit=50     cron + oneshot hidden unless quiet=1
GET  /api/sessions/<id|ref>                              card, diary, seances, last 40 turns
GET  /api/index                                          every row as JSON
GET  /api/seances[/<id>]
POST /api/scan          {"diary":true,"max":3}           rebuild; optionally write diaries for the newest N
POST /api/diary/<id|ref> {"force":true}                  deepseek writes the prose (10-25s)
POST /api/ask           {"session_id":"…","question":"…"} the dead session answers (10-45s)
POST /api/fork/<id|ref> {"title":"…"}                    verified copy, backup first
POST /api/restart/<id|ref>                               opens a terminal at hermes --resume
POST /api/rebuild
```

`<ref>` is the 8-hex prefix shown in the index; full ids work too. A title substring is resolved
through the store as a last resort, so `POST /api/ask {"session_id":"Salvage dead Main"}` works.

## How the two LLM paths work

Both shell out to the same real command and return its stdout — nothing is synthesized:

```
hermes chat --query-file <prompt.txt> --oneshot -Q
```

- **Diary** — the deterministic card (goal, outcome, files, commands, tools, first user turns, capped
  at ~14 KB) is the evidence; the model only writes 4-7 sentences of prose.
- **Ask** — the prompt tells the agent to read the session with its own `session_search` tool and
  answer from that transcript only; if the session lacks the answer it must say so.

Each spawn mints its own Hermes session (source `oneshot`), so the diary site hides those by default
and the seance records which one answered.

**Pitfall that cost a debug cycle:** `hermes` is a real `.exe` on this rig. Spawn it with an argv
array. Going through `cmd.exe /c "<line>"` re-quotes the arguments and `--query-file` receives a path
with literal quotes in it (`[Errno 22] Invalid argument`).

## Fork semantics

Fork is `/branch` done against the store instead of a live session: a new session row (same shape,
`parent_session_id` set, unique title `<title> (fork)`, counters reset), then the parent's visible
transcript copied row by row, then everything **read back and compared** — message count, first and
last message bytes, parent link, title. Any mismatch rolls back. A `VACUUM INTO` backup of `state.db`
is taken first (reused if less than an hour old).

Reads are `readOnly:true` on every path except fork; the store is WAL, so the diary can read while
Hermes writes.

## Gate

```
npm test        # esbuild + tsc --noEmit + node public/js/selftest.js   (51 asserts)
```

The selftest builds a fixture store with two sessions and proves card extraction, page writing,
inline JSON, diary/ seance rendering, fork copy + verification, and the API over real HTTP — with no
model call.
