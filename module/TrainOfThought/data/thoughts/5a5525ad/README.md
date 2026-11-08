# 5a5525ad — Add nodes and intent to the LAN database

**Intent.** One roster where every machine carries what it IS FOR, not just its address: role, `ready_for[]`,
and the door it answers on. Done means `fleetctl scan` reports intent per node, Join resolves each one by
name, and a node can be picked for a job without reading the desktop.

## State, 2026-11-07 18:24-18:40 UTC (session hermes-123-dag-20261107)

The roster is `C:/AI/fleet/roster.json` — declared intent, hand-editable, 12 rows (11 nodes + the controller).
Observed reality stays in `C:/AI/fleet/state.json`, written only by `fleetctl.py scan`.

| done-condition | how it is met now | evidence |
|---|---|---|
| every row carries intent | `role`, `ready_for[]`, `door`, `ip`, `hostname`, `notes` on all 12 rows | `api-join-roster.json` |
| `fleetctl scan` reports intent | scan table prints ROLE per node and `state.json` rows carry `declared.{role,ready_for}` | `scan-2026-11-07.log` |
| Join resolves each one by name | `GET :8131/api/roster` (list) and `/api/roster/<name>`; `/api/resolve/<name>` now falls through to the roster and answers `liveness:"declared", attached:false` instead of 404 | `api-join-roster.json` |
| a node can be picked for a job | `GET :8137/api/fleet?for=<capability>` ranks declared candidates: alive first, then ready-service count, then name; each row carries `endpoint` | `api-fleet-tts.json` |
| the LAN row shows what it is for | Menu renders a `For` row per node (`controller · llm, tts, video, image, music, mining, doors · 192.168.1.123`) plus the roster gap line | `lan-section-2026-11-07.png`, `lan-2026-11-07.md` |

## The scan, 2026-11-07T18:24:20Z — 5/11 up

    gtx1660 .149  UP    video   GTX 1660 SUPER 6GB 3.4/6GB 100%   cpu mining · llm gemma-4-E4B-it-Q5_K_M · hermes-gw :8642
    robert  .112  DOWN  image   ssh: connect to host 192.168.1.112 port 22: Connection timed out
    gvtx980 .134  UP    light   GTX 980 Ti 6GB 0.4/6GB 0%          cpu 367H/s
    beast   .122  UP    cpu     Microsoft Basic Display Adapter     cpu 2060H/s · no GPU driver
    ReX     .139  DOWN  gpu     ssh: connect to host 192.168.1.139 port 22: Connection timed out
    XPS     .140  DOWN  gpu     ssh: connect to host 192.168.1.140 port 22: Connection timed out
    XPSW    .142  DOWN  gpu     ssh: connect to host 192.168.1.142 port 22: Connection timed out
    main    .100  DOWN  salvage ssh: connect to host 192.168.1.100 port 22: Connection timed out
    jims    .127  UP    main    GTX 1050 2GB 1.3/2GB 100%           cpu mining · gpu SRB · llm qwen2.5-1.5b-instruct-q4_k_m
    andrewjames .131 UP cpu     Mobile 4 Series chipset             web :8081
    deadalus .129 DOWN  cardano ssh: connect to host 192.168.1.129 port 22: Connection timed out

`robert` (.112) and `ReX` (.139) are the two the old plan line named: both are OFF, so their hardware lines
are still the notes from when they last answered. That is the one open item on this node.

## What changed in code (all gates green)

    module/Mirror/src/roster.js      NEW - the reader: load, index, match by ip/ref/name/hostname, candidates, summary
    module/Mirror/src/lan.js         lan.json nodes[] gain { ip, intent{door,endpoint,role,ready_for} }; top-level `fleet`
    module/Mirror/src/main.js        reads the roster each refresh (5 s); GET /api/fleet?for=<cap>; /health reports the roster
    module/Mirror/selftest.mjs       +20 assertions                 48 passed / 0 failed
    module/Join/public/ts/roster.ts  NEW - declared rows, resolveDeclared(), runTests()
    module/Join/public/ts/apiServer.ts  GET /api/roster, /api/roster/<name>; /api/resolve falls through to the roster
    module/Join/public/ts/selftest.ts   the roster suite is in the gate  151 passed / 0 failed
    module/Menu/public/index.html    `For` row per node + roster line (12 declared · 2 on the LAN · 10 not here)

## Rebuilding / re-verifying by hand

    cd C:/AI/hydra-local/module/Mirror && npm test          # 48 green
    cd C:/AI/hydra-local/module/Join   && npm test          # build + typecheck + 151 green
    cd C:/AI/fleet && python fleetctl.py scan               # the observed half
    curl -s 127.0.0.1:8137/api/fleet?for=tts | node -e "..."   # who can do TTS, ranked
    curl -s 127.0.0.1:8131/api/roster/robert                    # declared, attached:false

Doors are restarted through ProcessWrapper (`POST :8125/api/processes`, `POST :8125/api/processes/<id>/kill`),
never as a loose console — Core/Mirror run `src/main.js`, Join runs `public/js/main.js`.
