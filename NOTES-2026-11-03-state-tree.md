# Hydra V2 — the state tree, and the Phoenix cycle as its heartbeat

Status: design agreed in conversation, nothing built. Written 2026-11-03, after the eyes/logo detour.
Read this before writing a "state server". There is no server in this design.

## What already exists (checked, not assumed)

- **State (:8127)** — a generic registry, boots BLANK, persists nothing. Its six laws are the design:
  1. generic — holds whatever it is handed, in the registrant's own shape
  2. entries describe themselves — `alive` (lazy liveness), `pull` (a live source), `serving: {log:'delta'}`,
     `render`, `update`
  3. the requester carries the mark — full state to a stranger, the delta past the mark to a familiar one
  4. names are paths — `Root.Server.ClientName`, resolvable by shortest unique suffix
  5. a registration lives as long as its registrant — absence reads as absence
  6. no clocks — refresh is two-sided: the source advertises a speed, the requester renders at its own
- **Join (:8131)** — members, shelf, resolve. This is the member list a reader pulls from.
- **Menu (:8133)** — the display; it already fetches a catalog and renders rows.
- **TrainOfThought (:8135)** — the frontier brief, and the **Phoenix cycle seam** in `public/ts/cycle.ts`:
  `recordTick(store, tick)` and `handoffPacket(store, sessionRef)`. The tick carries a monotonic `cycle`
  number, per-session `fillPct`, and produces handoff advice at `HANDOFF_FILL_PCT = 85`. **Nothing calls it.**

## The model (this is the agreed shape)

One object, addressed by path:

```
state.nodes.JimsLaptop.models.qwen      <- registered by Jim's laptop, in Jim's own registry
state.nodes.JimsLaptop.doors.menu
state.nodes.robert.services
```

- each node registers **its own subtree** in **its own** State; nesting is the children
- a reader (any node, the Menu, a plugin, a future broker) gets the member list from Join, **pulls** each
  member with its own marks, and assembles the tree locally
- nothing is pushed into anyone else's registry; nothing is mirrored; nothing expires by timer

Ownership is a property of *where the entry lives*, not a rule about who may write. That is why there is no
merge function, no conflict resolution, and no CRDT: two nodes can never write the same branch, because the
branch is only ever in its owner's registry.

## Why not a central "unifying" server

A box that holds the only copy dies and takes the LAN's view with it — for a project whose premise is
"generous people offering spare computers", that is the wrong single point. With pull, any reader can be the
unifier, and its death costs nothing. A librarian (one box that folds for a phone or for the future broker to
other LANs) is fine as a **reader that happens to hold everything** — replaceable by definition.

## The Phoenix cycle IS the heartbeat

The cycle number is monotonic. So liveness does not need a beat packet, a lease, or a clock in State:

| what the reader sees | what it means |
|---|---|
| cycle counter advanced since my last pull | alive, and cycling |
| counter unchanged for N pull intervals | stalled (asleep, blocked, or hung) |
| pull fails / no answer | unreachable — and absence reads as absence |

Two things make this clean:
- **measured at the reader** (law 6 gives the requester its own speed), so a 2013 laptop's clock is irrelevant
- **N intervals is the reader's choice**, not a value baked into the node — the Menu might use 3, a monitor 12

The cycle also carries `fillPct`, so pressure is visible on every node's screen, and its `handoff` advice is
already shaped to pair with the ToT frontier (`frontier: string[]` in `HandoffAdvice`).

Entry shape a node should register (proposal, not built):

```json
{ "name": "nodes.<ref>.cycle",
  "content": { "cycle": 1482, "at": "<owner's ISO time, informational only>",
               "fillPct": 62, "sessions": 3, "handoff": [] },
  "serving": { "cycle": "delta" } }
```

## The cycle finds the fallen

This is the part the cycle is *for*: it runs whether or not anyone has a window open, so it is the only thing
on the box that can notice a peer going away.

- **it ticks on a fixed interval regardless of work.** A heartbeat that only beats when busy is not a
  heartbeat — an idle node must look idle, not dead.
- **each tick, pull each member's cycle entry only** — not their whole subtree. One small pull per peer, in
  parallel, each with a hard timeout, so a dead peer cannot stretch the tick.
- **observations live under the observer's own branch**:
  `nodes.<self>.observed.<peer> = { cycle, seenAt, verdict }`. It is an opinion, not truth about the peer, and
  it is never written into the peer's branch.
- **three verdicts, with hysteresis**: alive (counter advanced) · stalled (counter static, port answers) ·
  gone (no answer). Not from one missed pull — a few intervals before stalled, more before gone, or every
  laptop lid closure becomes an incident.
- **screens show the union**: the peer's own cycle plus who last saw it and when. When those disagree, that
  disagreement is a partition — information, not an error to be reconciled away.
- **a fall becomes a train line**, not a console message: the cycle seam already appends `event` trail entries
  (`cycle 1482 · …`), so "JimsLaptop fell at cycle 1482 and had not returned by 1501" survives the session
  that noticed it.
- **nobody is the sole watcher** — every node observes every member. At LAN scale that is N small pulls per
  tick. If only one box watched, its own death would blind the LAN to everyone else's.
- **what the cycle must not do**: declare a peer dead from a single miss, block its own tick on a slow peer, or
  repair anything. Observation and repair are different decisions; repair (wake, restart, reassign) belongs to
  a policy the operator can see.

## The broker's broadcast is a MINIMAL state, nested with services

The broker does not trade full trees. What crosses that wire is a projection:

```
{ ref, cycle, at, ready_for?, pressure?,
  services: { "<slug>": { name, provider, karma, ready, modes? } } }
```

Rules for that projection:

- **derived, not authored** — it is a filter over entries the node already registered, so it cannot drift from
  what the node says about itself
- **nested, one entry per service** — a stranger can read one service without reading the node
- **no paths, no model inventories, no logs, no unadvertised doors** — nothing a stranger has no business with
- **a service that is not ready is still advertised** ("I have this, it is not up") — absence means "cannot",
  `ready: false` means "not now"
- the same projection is what a LAN-to-LAN link would carry later, so it is worth getting right once

## The broker: two verbs, and neither of them is shell

The broker does not exist yet. When it does, it is a deliberately narrow relay between nodes that do not share
full trust — not a control channel, not a remote console.

**Verb 1 — advertise.** The minimal projection above: `{ref, cycle, services{...}}`. An advertisement, so a
stranger can decide whether to ask. It carries no paths, no inventories, no logs.

**Verb 2 — job in / job out.** A request names a service **the receiver already has**, by slug plus one of the
modes that service declares, and carries inputs only. The receiver validates those inputs against that service's
own definition, locally, and answers with what the service produced.

What the broker must never carry:
- commands, argv, env, or a path to execute
- a service definition or code of any kind — the sender cannot invent a service, only ask for one that exists
- filesystem listings, or arbitrary URLs for the receiver to fetch on its behalf
- the state tree itself (the projection is the only advertisement; a peer's full state is pulled inside the LAN,
  where the trust already exists)

**The receiver decides, always.** The broker is a switchboard and an authority over nothing: it does not know
what a service is, cannot approve one, and cannot widen what a node offers. That is what keeps a dumb, auditable
relay safe — every rule lives on the node that runs the work.

**Refusals are typed and boring**: `unknown_service`, `bad_inputs`, `not_ready`, `over_karma`. A caller learns
that it was refused, not what is behind the refusal. Nothing about the node's internals leaks through an error
string.

**Consequence for Core:** the state tree must not depend on the broker. Inside a LAN, peers pull each other
directly; the broker exists to cross a boundary where that direct pull is not allowed. Two separate paths, one
of which may not exist for years.

## The end goal, and what it forces

The Menu is the product; everything else is plumbing behind it. The target screen is symmetric:

```
Local AI Menu                    <- THIS node, as it is today
  > llama-chat  …
  > piper-tts   …

Node — Jims Laptop               <- a peer, its own services, its own cycle
  > llama-chat   ready
  > whisper-stt  ready

Node — 123                       <- the same view, on Jim's screen
```

Every node shows itself and every peer it can reach; no node is special. That forces one rule, and it is the
rule the whole module set hangs from:

**PUBLISH OR BE INVISIBLE.** A module that holds something a peer would want to see publishes it as state
entries under this node's branch. Nothing is scraped, nothing is inferred by the menu, and a module that does
not publish simply does not appear — which is honest, and visible.

| what the menu shows | published by | entries |
|---|---|---|
| services, ready or not | Services | `node.<ref>.services.<slug>` |
| this box, its doors | Core | `node.<ref>.id`, `.doors` |
| is it alive, how long | Core | `node.<ref>.cycle` |
| what a peer saw of it | Core (observer) | `node.<ref>.observed.<peer>` |
| booked work, queue, running | Scheduler | `node.<ref>.scheduler.<job>` |
| pressure, vram, ram | ResourceManager | `node.<ref>.resources.*` |
| what is actually running | ProcessWrapper | `node.<ref>.processes.*` |
| what this session is serving | SessionDiary / TrainOfThought | server node only |

Scheduler is the one that most obviously needs this: a booking made on one node is worthless to the LAN until
it is an entry, and once it is, every screen shows "123 is booked at 14:00" without asking 123 anything.

## Modules worth adding (proposed, not built)

1. **Mirror** — the reader. Pulls peers on the LAN, caches the assembled tree, serves `/api/lan.json` and
   `lan.md`. Keeps Core single-purpose (register + tick) and gives an agent one call to read the whole LAN.
2. **Bench** — measures what a node can really do (t/s, VRAM, tokens) and publishes `node.<ref>.capacity.*`.
   The house rule is that a model fact is stat'd, never estimated; this is the same rule applied to a machine,
   and it is what stops work being routed to a card that cannot hold it.
3. **Ledger** — append-only record of asks and deliveries (who asked whom, what came back, how long, karma
   delta). Karma needs a substrate that cannot be rewritten; this is it, and it doubles as the audit trail.
4. **Ward** — runs each module's gate and publishes `node.<ref>.health.*` (degraded, failing module, last pass).
   A node that is broken should say so before anyone asks it for work.

Phoenix is not on that list because it is already planned: Core's 5 s tick is a placeholder for it, and the ToT
seam (`recordTick`, handoff at 85%) is where its numbers will land.

## Agent first

The design is for an agent to read before a human does. That means:

- **stable names** — a dotted path is an API; renaming one is a breaking change
- **typed values** — numbers are numbers, ISO strings are time, no prose in a field an agent must parse
- **one call** — `/api/lan.json` for the machine, `lan.md` for a session brief
- **absence is data** — a missing peer or service means "not there", never "unknown, try again"
- **`schemaVersion`** on the tree root, bumped when a path or a type changes

## Open questions (decide before code)

1. **Marks on disk or fresh each boot?** Disk = cheap steady state, survives restarts; fresh = stateless and
   simpler. A restarted reader that asks for the full tree once per boot is not a problem at LAN scale.
2. **Refresh interval, and who owns it** — the Menu at ~2 s is probably too eager if every node pulls every
   other node; a plugin at 5–10 s with an SSE nudge on change is cheaper.
3. **Stalled vs hung** — same counter plus a live port is "asleep"; same counter and no answer is "gone".
   Both render differently; neither is a purge.
4. **Handoff authority** — the cycle proposes, Echidna judges (already the seam's stated law). The state tree
   only carries the evidence.
5. **Does a node register a `peers.*` mirror at all?** Only for the view cache; never as truth.

## Traps (the ones that will actually bite)

- A pull that waits on a dead TCP connect hangs the menu: **parallel pulls + a hard per-peer budget
  (~300–500 ms)**, and a rendered "unreachable" state instead of a blocking call.
- `alive` must be cheap — a port or `/health`, never the full pull, or liveness costs as much as reading.
- Don't pull yourself as a peer and count yourself twice.
- Steady state must ride the delta flag, or every tick re-reads the whole tree.
- A laptop that closes its lid must read as **asleep**, not gone — that is the reader's N, not a lease.

## Smallest honest build order

1. **Register the node's own subtree at boot** (shelf, from `node.json`) — makes the object exist at N=1, and
   is the child the second box will make visible.
2. **Reader**: member list → parallel pull with marks and a timeout → one assembled view.
3. **Menu strip**: heads seen, cycle counter, stalled/unreachable, pressure where known.
4. **Plugin gating**: no peers → does nothing (not "does a little"). At N=1 there is nothing to read.

## What is deliberately not in this note

- no port numbers for new services (none are needed)
- no Echidna in the path (the cycle's handoff output feeds her, not the reverse)
- no persistence on the reader (a cache, not a store)
