# Phoenix Cycle

The maintenance registry. Not a scheduler that knows what maintenance is - a registry that runs entries their owners
raised, the same way Event_Handler and the Process Manager work.

```
node server/main.js --port 8146 --every 10
```

Every entry declares two surfaces: the tick its trigger fires and the port this door answers on its behalf. Triggers
are validated at registration; `cron` and `after` are understood and refused in v0 rather than silently skipped.

    GET  /health              entries, beats, next beat
    GET  /api/entries         what is registered, with each one's last receipt
    POST /api/register        add or replace an entry (validated)
    POST /api/tick            force a beat now
    GET  /api/receipts        per-entry receipts (jsonl on disk)

Not the Scheduler. The Scheduler decides what a node does with its GPU - work, idle service, leases. Phoenix decides
what upkeep is due - docs drift, dead leases, receipts, session debt. They share a clock and nothing else, and Phoenix
never starts AI work.
