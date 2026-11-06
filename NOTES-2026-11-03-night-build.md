# Night build — the LAN view is real

Built 2026-11-03 between 05:00 and 05:35 while you slept. Everything below was run, not imagined; the numbers
are from the live boxes.

## What exists now

| piece | where | what it does |
|---|---|---|
| **Core** :8136 | 123 + jims | registers this node's own subtree in its own State; ticks the cycle; observes peers |
| **Mirror** :8137 | 123 + jims | pulls this registry + every member; serves `/api/lan.json` and `/api/lan.md` |
| **Menu — LAN section** | 123 + jims | under the local list: `Node — Jims Laptop`, chips, its services, its bookings |
| **Scheduler publisher** | 123 | the book becomes `node.<ref>.scheduler` + `.booked.<jobId>` |

The screen you asked for is live: Local AI Menu as it was, and below it the peers, symmetric on both boxes.

## Verified, with numbers

- **Core gate 30/30** — ref naming, entry shapes, the full verdict table, and the broadcast projection
  (including a `leaks()` test that fails if the projection ever exposes more than `ref, cycle, at, ready_for,
  pressure, services{name, provider, karma, ready, modes}`).
- **Mirror gate 25/25** — assembly, rollups, the brief, and the two copies of the verdict rules are compared
  against each other over a matrix, so they cannot drift silently.
- **Scheduler gate 51/51** (was 45) — queued → entry, inputs published as KEYS only, finished → dropped.
- **Peer gate (live, 45s)** — a synthetic peer that advances, freezes, then dies:
  `alive → stalled → gone`. This is the proof a real laptop cannot give.
- **State on 123** — `node.123.cycle`, `.id`, `.doors`, `.services` (index + 4 nested), `.scheduler`.
- **State on jims** — `node.jims.cycle`, `.id`, `.doors`, `.services` (index + 4 nested).
- **Both directions** — 123's Mirror: `123 alive cycle 7 · Jims Laptop alive cycle 41`, 8 services, all ready.
  Jim's Mirror: `Jims Laptop (this node) · 123 — this box (peer) alive cycle 9`, 9/11 doors.
- **Doors** — 12 up on 123 (8125, 8127–8137), Core and Mirror started BY THE APP (`DOOR_TABLE`), so they come
  back with the window.

## Four real bugs found by verifying instead of trusting

1. **Inverted drop condition** in `readServices` — it deleted the service entries it had just written
   (`if (seen.has(slug))` instead of `if (!seen.has(slug))`). Caught by looking at State after the write.
2. **A dead peer froze the whole reader.** `AbortController.abort()` did not settle a fetch whose socket was
   destroyed; the refresh loop silently stopped updating. Fixed by racing a hard timeout in both
   `Mirror/src/main.js` and `Core/src/stateClient.js`.
3. **`view()` dereferenced a null node** when a peer went away — the throw was swallowed by the interval's
   `.catch`, so the LAN view stayed frozen at "stalled" forever. Fixed, plus `/health` now exposes
   `refreshError` and `refreshes` so a swallowed failure is visible next time.
4. **`ref` resolved to "scheduler"** because the publisher looked for `node.json` one directory too high; it
   published `node.scheduler.scheduler`. Fixed and the bad entry dropped.

## Decisions taken (reversible, but argued)

- **Doors now bind `0.0.0.0`, not `127.0.0.1`.** Loopback-only made 123 invisible to the rest of the house,
  which is the whole point of the feature. This matches how .127 has always run. Undo: one line in
  `Basic_App/electron/main.cjs` (`doorArgs`).
- **Names are split, not one blob**: `.cycle` is cheap and pulled by every peer every tick; `.services` is an
  index (one pull for a reader) *and* nested per-service entries (one pull for a stranger asking about one
  service). Both written from the same pass, so they cannot disagree within a tick.
- **Scheduled tasks were blocked on 123** (`Access is denied` — no elevation), so Core and Mirror are hosted by
  the app's door table instead. On .127, where task creation works, they are `jims-core` / `jims-mirror` tasks.
  Two different hosts for the same two services is a wart worth unifying later.
- **Scheduler publishes queued + running only**, one entry each; finished jobs become a count. History stays
  local so a long-lived node does not grow the LAN's state without bound. Inputs are published as their KEYS,
  never their values.

## Not done (in the order I would do it)

1. **Peer rows are not clickable.** The Menu shows a peer's services but clicking does nothing — there is no
   remote run path yet, and inventing one silently would be a lie. Needs the job envelope from the broker
   section of `NOTES-2026-11-03-state-tree.md`.
2. **Bench, Ledger, Ward** — designed in the notes, not built. Ward is the cheapest and the most useful first:
   it makes a degraded node say so instead of failing quietly.
3. **Marks on disk** — the reader takes a full pull on boot. Fine at N=2, worth revisiting at N=10.
4. **Two hosts for the same services** (door table on 123, tasks on .127) — unify on one.
5. **The Menu gate does not test the LAN section** — it tests the page it serves, not the inline client script.
   The peer gate covers the data; the DOM is verified only by eye.

## How to check it in the morning

```
curl -s http://127.0.0.1:8137/api/lan.md                 # both nodes, verdicts, services
curl -s http://127.0.0.1:8136/api/broadcast              # what a stranger would be told
curl -s http://127.0.0.1:8127/api/state | findstr node.   # the entries this node publishes
ssh jims "curl -s http://127.0.0.1:8137/api/lan.md"       # the same view from the laptop
```
Open the Hydra window: the left panel scrolls from Local AI menu into "Nodes on this LAN", and the heading
sticks while the peer list scrolls under it.

Kill a node and watch it: stop the Core process on .127 (`Stop-Process` on whatever owns :8136), and its chip
goes `alive` → `stalled` (3 ticks ≈ 15 s) → `gone` (12 ticks ≈ 60 s), without either side storing anything.
