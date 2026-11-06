# Idle Service — the Scheduler decides when a node is idle

## The decision
The Scheduler is the single authority on idle. It already keeps the book of jobs — queued, running, finished — so it is
the only door that can answer "is this node in use" without keeping a second opinion. ResourceManager records bookings;
ProcessWrapper is the only thing that may stop or start a process; the Scheduler is the one that decides.

## The definition
    idle  =  no queued job  AND  no running job  AND  now - lastJobEnd > after
    after =  node.json standby.after   (default 30m, a config value, no rebuild to change it)

## The transitions
    idle  --(timer fires)-->  start standby, verify it, report standby.running
    busy  --(job booked)-->   stop standby -> poll ProcessWrapper until gone -> launch the job
    done  --(job released)--> lastJobEnd = now, timer restarts

## The trap
`schtasks /end` returns before the process is gone, and a miner holds the card for seconds afterwards. A job launched
on the return of that call fails on VRAM. Stop -> poll PW until absent -> then launch. A timeout is reported as
`blocked: standby would not release`, never as a half-run.

## Still addressable directly
    POST /api/standby {action:start|stop|pin}
`pin` disables eviction for that node, so a deliberate mining run is not preempted by an impatient job.

## Module map
Generated from source (every edge is a port named in code): `C:\AI\hydra-local\docs\module-map.html`
