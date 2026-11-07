# Phoenix Cycle — registration model

Phoenix is not a scheduler that knows what maintenance is. It is a **registry** that runs entries other modules register,
the same way Event_Handler and the Process Manager do. Two surfaces per entry, always both:

```
THREAD   an in-process tick the owner implements      (cheap, no socket, called by the cycle)
PORT     an HTTP door the owner answers               (inspectable, testable, visible in the Menu)
```

An entry that only ever exists in a thread is a background process nobody can see — the exact thing the VISIBILITY
RULE forbids. An entry that only exists as a port needs a caller to remember it, which is the failure mode this module
exists to remove. So: **a registration is not valid until both `tick()` and `http` are declared**, even if `http` does
nothing but report `{ ok, lastReceipt }`.

## Entry

```json
{
  "id":          "docs.module-help",
  "owner":       "Core",
  "title":       "Module help pages match their manifests",
  "kind":        "code",              // code = deterministic | nag = needs judgement (Echidna)
  "trigger":     { "every": "6h" },    // or { "cron": "0 4 * * *" } or { "on": "manifest.changed" } or { "after": ["ref"] }
  "action":      { "module": "Core", "func": "regenerateHelp" },
  "port":        8146,
  "lease_s":     120,                  // the action must finish or be cancelled inside this
  "receipts":    "data/phoenix/docs.module-help.jsonl",
  "enabled":     true
}
```

`nag` entries have no `func`. Their action is a ToT node (`tag: nag`, `due`) that the cycle surfaces **one at a time**
in the monitor, with the same card that already answers questions: TL;DR buttons on top, free text always, tap or type.
A nag that fires when Echidna is not live is not lost — the node stays open and the next tick that finds an agent
surfaces it.

## Rules

1. **Registration is data.** Entries live in `module/Phoenix/data/registry.json`; any module can add one without
   editing Phoenix. A registration names its owner, so the cycle never guesses who is responsible.
2. **Triggers are declared, never inferred.** `every`, `cron`, `on` (event name), or `after` (DAG refs) — no trigger,
   no entry. A trigger that cannot be evaluated is a refusal at registration time, not a silent no-op at 3am.
3. **Every run leaves a receipt.** `{ id, cycle, started, ended, outcome, changed[], error? }`. "Did the cycle run" is
   a fact read from receipts, not a feeling.
4. **Leases, not runs.** An action gets `lease_s`. Overrun is cancelled and recorded as a failure, so one slow action
   cannot starve the cycle the way one slow cron job hides the rest.
5. **One close button.** The cycle and every entry it started are stoppable from the Hydra app; stopping the cycle
   cancels outstanding leases and leaves receipts saying it was stopped, not that it succeeded.
6. **Empty is normal.** A fresh install may have zero entries and Phoenix is still correct. Nothing is pre-registered
   "just in case" — the registry reflects real maintenance or it is empty.
7. **Escalation, not ambition.** Past ~20 entries with dependencies between them, the plain list stops being readable
   and a node graph is the honest UI (litegraph or equivalent: entries as nodes, triggers as edges, receipts on hover).
   The registry format above is already the graph — `after` is an edge — so the UI can arrive later without a data
   migration.

## What the first entries should be

```
code   docs.module-help        regenerate help pages from manifests, diff and report drift
code   state.revision          bump lan.app.rev after a clean tree + green gates
code   leases.sweep            drop state leases with no heartbeat, and say which node went quiet
code   receipts.verify         re-hash yesterday's artefact digests, flag mismatches
code   salvage.inventory       re-stat the salvage destination, report bytes added and free space
nag    session.debt            any module without a selftest suite, named, one per tick
nag    tot.review              open nodes older than N days with no trail entry
```

Those six are the answer to "all these things I make need updating" — none of them require a model, and the two nags
are exactly the "remind Echidna" lane, kept visible as DAG lines rather than hidden timers.
