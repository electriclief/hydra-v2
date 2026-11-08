# 33c9ac28 — fleet tree, lit rows, cpu miner

## What was measured today (2026-11-08)

xmrig 6.26.0 on robert, i5-9400F, **2 threads**, pool rx.unmineable.com:3333 (rx/0, RandomX):

```
speed 10s/60s/15m   535.5 n/a n/a H/s   (first samples)
speed 10s/60s/15m   540.5 538.7 n/a H/s (settled)
job from rx.unmineable.com:3333 diff 100001 algo rx/0 height 3802010
shares in 120 s: 0 — expected time to one share at 538 H/s and diff 100,001 is ~186 s
```

So the CPU miner earns at roughly **1/167th of the GPU's 90 MH/s quantus rate** in hashes, and a CPU share arrives
every ~3 minutes at best. It runs BESIDE the GPU (two threads the card does not need), not instead of it.

## Ritual

1. `node.json standby.cpu = { enabled, command, args, apiPort, label, threads }` — instance data, per node.
2. guard reads it and raises `standby-cpu` as a ProcessWrapper row beside `standby-miner`.
3. `cpu-wall.ps1` is its own console row and window: `cpu-wall`, title `robert - cpu`.
4. `GET :8127/api/state/pull?name=node.robert.standby` must carry `cpu: {...}` beside `minerDetail`.

## Known traps

- Defender quarantines miners; C:\AI\tools\xmrig needed an exclusion (`defender-allow-xmrig.ps1`). A quarantined miner
  looks exactly like a broken one: the exe vanishes and the launcher says "contains a virus".
- xmrig needs huge pages for full RandomX speed; without them it silently drops to light mode. The measured 538 H/s is
  whatever mode it picked, recorded as-is.
- An unmanaged node must never borrow a neighbour's state: no door means the tree shows the roster's declaration plus
  whether ssh answered, nothing else.
