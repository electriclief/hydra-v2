# TrainOfThought — the intention DAG

What is still wanted, and why it is wanted. A node is an intention that outlives a session; `next[]` is
what would move it; closing it files the sentence that says why it stopped. Nothing here is a job log:
a Scheduler run, an image render or a door restart creates no node.

It is a Hydra V2 door (port **8135**) and the window's **Thoughts** tab. The page is a tree, because the
question this module answers is "what is there, and what is still owed" — not "what ran last".

```
C:\AI\hydra-local\module\TrainOfThought\
  public\ts\                   ← sources (edit these, never public\js)
  data\thoughts\<ref>\         ← one folder per node: README.md (the body), trail.jsonl
  data\frontier.md             ← the one page a session reads first
  data\seats.json              ← who is on this train, and its lease
```

## The tree (`/`)

Three sections, all of them computed at request time so nothing can drift from the door:

- **Service outputs** — folders this shelf actually produced (`docs`, `docs/voice-samples`, `media/ep01`,
  `module/SessionDiary/data/files`, the thought nodes themselves) with real file counts, bytes and the
  newest mtime. `open folder` posts to `/api/open`, which refuses anything outside the shelf.
- **Hydra V2 design** — nodes tagged `design`, with their open questions listed underneath.
- **Wanted, not built yet** — the union of every open node's `next[]`, deduped, newest train first,
  capped at 60 with the true total shown. This is the section that answers "what did I ask for that has
  not been built".

`/trains` is the older frontier index (frontier marked, blocked reasons, archive link).

## Seats (the vocabulary)

A **seat** is a session on this train: `POST /api/seats {sessionRef, ref}` with `login`/`logout`. The seat
carries the node it is working and expires on its own. A **claim** is the same idea one level down — a
lease on one node, with a holder and a deadline (`/claim`, `/release`). A **holder** is whoever owns the
claim right now; `not_holder` and `claimed` are refusals, not overwrites. Closing a node is the only
operation that ends an intention, and it requires the sentence saying why.

## API (the agent's entry point)

```
GET   /health
GET   /api/thoughts?state=&q=&tag=          list (done hidden unless state=done|all)
GET   /api/thoughts/<ref>                   one node + deps resolved + readiness
GET   /api/next                             THE frontier row, or the wall it hit
GET   /api/archive                          closed nodes with their closing sentence
GET   /api/handoff/<sessionRef>             packet for a successor session
GET   /api/tree                             outputs + design + wanted, one call
GET   /api/outputs                          the disk scan alone
POST  /api/thoughts                         {title,intent?,deps?,next?,tags?}
PATCH /api/thoughts/<ref>                   {title?,intent?,next?,tags?}
POST  /api/thoughts/<ref>/link | /unlink    {dep}
POST  /api/thoughts/<ref>/trail             {kind,text,by?,sessionRef?}
POST  /api/thoughts/<ref>/state             {state,parked|blocked|active}
POST  /api/thoughts/<ref>/close | /reopen   {summary,sessionRefs?} | {}
POST  /api/thoughts/<ref>/claim | /release  {by,minutes?} | {by,force?}
POST  /api/open                             {path} — explorer, shelf-only
POST  /api/cycle/tick                       {cycle,sessions[...]}
```

Errors carry a code (`no_such_node`, `claimed`, `not_holder`, `no_route`, `bad_json`) so a caller never
has to parse prose.

## How the frontier works

A node is ready when every ref in `deps[]` is closed and no live claim blocks it. The frontier is the
ready set ordered by dependency depth, so `next[0]` on a ready node is literally the next action;
unready nodes explain themselves through `whyStuck`. The store is append-only per node (`trail.jsonl`);
`next[]` is the one mutable list, which is why "wanted, not built" can be computed rather than curated —
an ask disappears only when its line is removed or the node closes.

## Gate

```
cd C:\AI\hydra-local\module\TrainOfThought
npm run build && npm run selftest        # 63 assertions
```
