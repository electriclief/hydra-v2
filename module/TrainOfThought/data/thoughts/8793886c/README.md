# 8793886c — State is a bulletin board with per-owner branches, never a hub

**The open line was:** "LAN row still missing: Core.observePeer pulls only node.<peer>.cycle. It must also
carry standby, Mirror must expose it, and the Menu must render 'Idle Service · mining' per node — then Jim
shows mining."

## State, 2026-11-07 (session hermes-123-dag-20261107)

| piece | state | proof |
|---|---|---|
| Mirror exposes standby | already true: `READER_NAMES` includes `standby`, `standbyOf()` trims it, `lan.js` carries `standby` per node | `lan-nodes-2026-11-07.json` |
| Menu renders it | chip `mining PearlPow` + row `Idle Service · PearlPow 24.1 TH/s - 27 shares this run - reported 2s ago` for 123 | `lan-section-2026-11-07.png` |
| **Core carries standby** | NEW: one extra pull per peer (`node.<peer>.standby`), trimmed to `{mode, ai, miner, at, ageS, stale}`, stored in the observation AND in `/api/tree` peers | `standby-peer-test-2026-11-07.txt` (7/7) |
| Jim shows mining | **NOT met, and not a code problem here** | jims' State `:8127` at .127 answers nothing (46 missed at 18:40 UTC); `fleetctl` sees the box UP over ssh with cpu+SRAM mining. Its shelf predates the standby guard, so it publishes no `node.jims.standby` — the fix is the shelf/guard rollout on that box (see 44ff5033, 49e30c7a) |

## Why a synthetic peer

No live peer on this LAN publishes `node.<ref>.standby` today, so the code path was proved against a stub
State that answers `node.fake.cycle` (advancing) and `node.fake.standby` (mining) while recording every
register Core posts. That is a real HTTP proof, not a unit test of a string:

    cd C:/AI/hydra-local/module/Core && node test/standby-peer.mjs
    ok   the peer is seen
    ok   the peer verdict comes from its advancing cycle
    ok   the tree carries what the peer is doing
    ok   the standby keeps its detail-free facts
    ok   Core writes the observation under its own branch
    ok   the written observation carries the standby
    ok   the observation never claims a cycle it did not see
    Core standby integration: 7 passed / 0 failed

## Standing rules on this node (unchanged, not work items)

- `data/standby/guard.state.json` stays a local fallback only, used when State cannot answer; it is never the
  LAN truth. `node.<ref>.standby` in each node's own State is.
- Any new module (file transfer) declares its own branch namespace and never writes `.scheduler` or `.standby`.

## Files

    module/Core/src/verdict.js     standbyOf(raw, at) + observation(verdict, at, standby)
    module/Core/src/main.js        observePeer pulls standby once per tick (500 ms budget, 404 costs nothing)
    module/Core/selftest.mjs       +9 assertions                     45 passed / 0 failed
    module/Core/test/standby-peer.mjs   the integration proof above
