# Hydra V2 — not working

This repository is a construction site. There is no installer, no release, no supported way to run it,
and nothing here is a product. If you clone it expecting an app, it will not work for you.

Written down honestly because the alternative — a tidy README that implies a finished thing — is how
people waste a weekend on someone else's half-built house.

## Status

- **Not working.** One machine (this one, `123`) runs a shelf of doors. Every other box is a target, not a member.
- Roughly **day 100 of a 300-day build**, across several nodes and several rewrites.
- The idea is small and specific: *any app on this LAN should appear on every node's menu as a service,
  one user, zero security, karma instead of money.* None of that is delivered yet. The menu is a list of
  what this shelf knows, not a marketplace.

## What "not working" means concretely

- **No install-from-zero.** There is no bundle that turns a fresh machine into a node. The shelf exists on
  exactly one disk; three other nodes were probed and have nothing.
- **Hardcoded paths and ports.** `C:\AI\hydra-local`, ports 8125–8137, 8199. Nothing negotiates.
- **One node publishes state.** The LAN view is honest about the rest: their rows say "no report",
  because nothing on those boxes is publishing.
- **No broker.** Talking to other people's home LANs is a boundary in the design, not code.
- **No authentication. By design.** One user, zero security. That is the concept, not an oversight —
  but it also means this must never face the internet as it stands.
- **Shelf sync is pull-only and proven on one node.** No rollback, no Apply button in the GUI, no
  menu row showing rev-vs-rev.
- **Nothing is packaged.** No Electron build, no service definitions you can trust, no release artifact.

## What does exist, with numbers

Measured on `123` on 2026-11-06, not estimated:

- **13 doors**, **43 MCP tools** across 7 of them (ProcessWrapper, Event_Handler, State, Services,
  ResourceManager, Join, Scheduler).
- **Shelf revision** `rev=22562d72…`, 448 files, 6.27 MB of code and definitions, excluding weights and
  runtime data. Every file hash-verified on arrival; a mismatch is a refusal, not a warning.
- **Idle Service guard**: mining yields to real GPU work and returns after a grace window.
  Live: `pearlhash 24.3 TH/s`, 3 shares accepted, two idle llama-servers parked in memory while the
  card hashes. Preemption was observed live (`YIELD 19:40:50` → `RESUME 19:42:05`).
- **Train of Thought**: intentions as a DAG with a tree page — outputs on disk, design state, and every
  ask still waiting. 75 open asks, computed from `next[]`, not curated.
- **Gates**: Scheduler 51/51, TrainOfThought 63/63, service-schema 10/10, Services 10/10.

## Layout

```
module/            one folder per door; each has a README and its own gate
  Basic_App/       the Electron shell: door table, watchdog table, tabs
  ProcessWrapper/  every child process, with a life, a log and a stop button
  State/           the bulletin board: per-owner branches, no relays
  Event_Handler/   every happening; the palette is declared in data/palette.json
  Services/        service definitions, shelf manifest, pull-only sync
  Scheduler/       the book of jobs, one at a time, and the status line
  Join/            the shelf describing itself: kinds, members, resolve
  ResourceManager/ this node's register: cpu, ram, gpus, disks
  Menu/            the way in: services, LAN view, bookings
  SessionDiary/    sessions as pages you can read and fork
  TrainOfThought/  intentions, frontier, archive, the tree
  Core/            the heartbeat: observes peers, writes this node's cycle
  Mirror/          assembles self + observations into one LAN view
scripts/           standby-guard.ps1 and the probing tools
docs/              help pages, module map, cast pages (samples excluded from git)
```

## The rules this is being built to

These are the decisions that keep the thing coherent, and the ones that get enforced in review:

1. **State is a bulletin board with per-owner branches, never a hub.** Each module writes only its own
   branch, from facts it alone is authoritative about. Nothing relays another module's facts.
2. **All events go through Event_Handler; State carries metadata notes, never payloads.** An event says
   something happened; State says what is true now.
3. **Nothing runs invisibly.** Every process is declared, listed, and has a close button — by process,
   by API, or the whole stack.
4. **The fleet pulls, never pushes.** A pull is initiated by the node, visible on it, and refuses a
   hash mismatch. A push is an invisible mutation on someone else's machine.
5. **Idle belongs to the Scheduler; the guard owns the branch it publishes.** A work definition is not
   a process name: an idle server holding a model is parked, not busy.
6. **Karma, not money.** No payment path anywhere in the design.

## If you want to poke at it anyway

You will be editing paths. Windows 11, Node 22+, PowerShell 7, and the shelf copied to
`C:\AI\hydra-local` — nothing negotiates that path yet. Then, from `module/Basic_App`:

```
node electron/main.cjs      # the shell: raises the doors and the guard, shows the tabs
```

Expect breakage. That is the current state of the thing, stated plainly.
