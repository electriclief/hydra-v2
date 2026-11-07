# Train of Thought — frontier

generated 2026-11-07T00:03:43.029Z from thoughts.json · 25 nodes (22 active, 1 blocked, 0 parked, 1 done)

This file is generated. Do not edit it by hand; edit the store and it rewrites itself.

## Open and ready

A session usually serves MORE THAN ONE of these. Say which `ref`s you are serving, and record each
with a `session` trail line (`POST /api/thoughts/<ref>/trail` `{kind:"session", text:"…", sessionRef:"…"}`).
`session-start.mjs --take a,b` writes all of them in one go.

### 5a5525ad — Add nodes and intent to the LAN database

intent: One roster where every machine carries what it IS FOR, not just its address: role, ready_for[], and the door it answers on. Done means fleetctl scan reports intent per node, Join resolves each one by name, and a node can be picked for a job without reading the desktop.
deps: 0/0 · tags: lan, fleet
next:
  - re-probe .112 and .139 into roster.json with real hardware lines
  - give every row a role and ready_for[] instead of free-text notes
  - register the fleet page as a Join member on :8137

### 954deebc — Wire the Thoughts tab into the window

intent: The door answers; the window still has to raise it and show it as a tab owned by ProcessWrapper, so no console is ever loose on the desktop.
deps: 1/1 · tags: hydra
next:
  - stop the hand-started doors before launch so ProcessWrapper owns them
  - relaunch the window and confirm the Thoughts tab loads

### f2e2deb0 — Every new session starts from the frontier

intent: Done means a session that starts on this box - with every door down - reads the frontier brief, says which ref it serves, and that link is visible in the session manager. The store stays the truth; no daemon is required to know what is next.
deps: 1/1 · tags: hydra, tot, session, frontier
next:
  - read module/TrainOfThought/data/frontier.md at session start
  - run TrainOfThought/scripts/session-start.mjs --session <id> --take <ref>
  - surface 'serving' on the diary page, not only in /api/sessions

### 64a4cbb3 — State tree: each node registers its subtree, readers pull with marks

intent: One object, addressed by path: state.nodes.<ref>.<child>. Each node registers its OWN subtree in its OWN State registry; readers take the member list from Join and pull each member with their own marks, assembling the tree locally. Done means a node's subtree exists at boot at N=1, a reader assembles N peers in parallel without hanging on a dead one, and the Menu shows every head with its Phoenix cycle counter. No central server, no push, no lease, no TTL.
deps: 0/0 · tags: hydra, state, lan, phoenix, design
next:
  - register the node's own subtree at boot from node.json (makes the object exist at N=1)
  - write the reader: members -> parallel pull with marks + per-peer timeout -> one assembled view
  - decide marks on disk vs fresh each boot (open question 1 in NOTES-2026-11-03-state-tree.md)
  - Menu strip: heads seen, Phoenix cycle counter, stalled vs unreachable, pressure where known
  - gate: synthetic peer that advances its cycle, then stalls, then goes silent - prove the three states

### 2629893c — Service definitions carry an install face (schema v2)

intent: Done means every service definition reads with schema 2, carries an install block whose steps each have a mechanical verify, and every behaviour change shows a credited installer_history entry. The loader side is green already; what remains is content, so any node can pick this up from the DAG without a session.
deps: 0/0 · tags: hydra, services, schema, install
next:
  - write the install block + first installer_history entry into yue-music as the pattern, using the measured audio.cpp numbers
  - roll the same shape into llama-chat, qwen-image-2.1 and minimax-h3 - mark verified:false wherever no run backs the claim
  - add chatterbox-tts, qwen3-tts-voicedesign and piper-tts with install faces and measured RTF
  - run export-library.mjs and confirm the library gate holds with the new fields present
  - document schema / revision / installer_history / install in the authoring contract so the next author inherits it

### cd60ec6e — Deferred questions: ask them when the operator is ready

intent: No question that was asked and deferred gets lost. Each is captured at the moment it is deferred, listed under this ref, and answered once into a decision trail line. The operator triggers the backlog with "Train of Thought - I am ready for outstanding questions".
deps: 0/0 · tags: operator, questions, ritual
next:
  - ask: test the CUDA build on the 980 Ti (about 1 GB) or keep Vulkan as the recorded rule, marked verified:false
  - ask: does the install executor become a door that shells out over SSH, or stay agent-driven with the door as ledger
  - ask: permanent home for TTS - ReX while its plug is in, or 123 where 16 cores are already powered
  - ask: what floor does each audio service declare - 6 GB Turing, 2 GB GCN, or CPU-only
  - ritual: every session that defers a question appends one next[] line here with the date and why it was deferred

### 291eac93 — Character voices from a description (Sophion, Destiny, Kate)

intent: Three distinct, repeatable character voices that need nobody elses recording: the timbre comes from an instruction string, so the same text recreates the same voice on any node. Done means each character has a fixed instruction kept in a file, an expressive sample set (neutral / happy / sad / angry / laugh) measured for RTF and pitch, and one engine chosen with numbers rather than adjectives.
deps: 0/0 · tags: voice, tts, cast, episode
next:
  - pick the path per sample after listening: the three bases must be told apart with eyes closed
  - lock each voice to a file (voice-destiny.txt, voice-kate.txt, voice-sophion.txt) so a re-run reproduces the timbre
  - test whether emotion belongs in the instruction or in the engine (chatterbox has explicit emotion control; qwen3 vdes does not)
  - measure warm-cache RTF properly: the 1660 numbers were cold-start and are not comparable to the 980 Ti warm runs
  - decide the serving node once warm RTF is known on the RX 6800 - it is the only card that could make this realtime
  - build the episode 2 dialogue bed from these voices and compare against ep01 v4 by ear

### 8793886c — State is a bulletin board with per-owner branches, never a hub

intent: 
deps: 0/0
next:
  - LAN row still missing: Core.observePeer pulls only node.<peer>.cycle. It must also carry standby, Mirror must expose it, and the Menu must render "Idle Service · mining" per node - then Jim shows mining.
  - The guard file data/standby/guard.state.json stays as a local fallback only (used when State cannot answer); it is never the LAN truth.
  - Any new module (file transfer) declares its own branch namespace and must not write .scheduler or .standby.

### e093f426 — Hydra V2 design — what is built, what is open

intent: 
deps: 0/0 · tags: design
next:
  - Answer Q3 (node order) so the LAN rows stop saying "no report".
  - Decide Q2 (Idle Service owner) before more standby logic is written.
  - Decide Q4 (module map in help) - the generator exists, the link does not.

### 44ff5033 — Events go through Event_Handler; State holds metadata notes, never payloads

intent: 
deps: 0/0
next:
  - Jim's laptop publishes no node.jims.standby - its box predates the guard; the shelf pull is the fix.
  - Decide whether the palette is owned by the shell (for out-of-process producers) or by each module at boot.

### 49e30c7a — Shelf revisions: nodes pull, never get pushed

intent: 
deps: 0/0
next:
  - Bootstrap, not update: NO other node carries a shelf at all (.149, .134, .147 all Test-Path False). First use is install-from-zero - needs a bundle (tar/zip of the code scope) plus a one-command installer that verifies the archive hash.
  - Models stay out of the manifest: 2.8 GB weights travel by peer HTTP now, torrent only when the broker leaves the house.
  - No rollback yet: keep one previous generation per file (,shelf/prev/<rev>) so a bad revision is one word away.

### 8ff46a1b — Offload to local agents: every node has llama.cpp, so Hydra should hand work to its own fleet

intent: Every node runs llama.cpp. Instead of winging it, agents become a declared Hydra capability that Echidna can call over MCP: keep help html current, babysit services declared to run on N nodes, and any job a local model can do. Offload is a job like any other, not a parallel universe.
deps: 0/0 · tags: agents, mcp, offload, modules
next:
  - declare an 'agent' block per node: model, context size, allowed tools (none by default), concurrency, and what it may touch
  - an MCP-easy verb: ask_agent(node, prompt, tools, context) so Echidna hands work to another node's model instead of doing it in one context
  - the offload job is the SAME shape as a scheduler job - one book, so the countdown and the preemption already work
  - typed refusal: a node without the model, the VRAM or the slot refuses with a reason the caller can read - never a timeout
  - docs agent: reads a module's help.html + code, proposes the diff, files it as a job; runs on whichever node is cheapest
  - service babysitter: a declaration says service X should run on N nodes; the module reconciles start/stop/adopt through ProcessWrapper and reports drift
  - drift is state, not an event: node.<ref>.services.<name> says declared vs actual, and the LAN row shows it
  - the offload record carries who asked, what was given, what came back, tokens, duration - visible on the LAN row, not buried in a log
  - agents get no shell by default; tools allowed per node are declared, and a call that needs what a node does not offer is refused at the door
  - one Echidna per LAN still: the fleet's agents are workers, not a second brain
  - what an agent may write is declared too (docs? state? nothing) - a worker that can edit the book is a second scheduler

### daa96bc0 — Phoenix Cycle: a 10-minute beat that triggers a declared action list, and can Tell Mom

intent: The heartbeat of a node. For now it is an X-minute loop (start with 10) that fires an action list which is empty until we fill it, and it must be able to 'Tell Mom' - the notify/report protocol for when a cycle has something to say. It grows by adding actions, not by changing the beat. Its own module and door, displayed in the Menu beside Echidna; the cycle number the LAN rows show comes from it, not from Core.
deps: 0/0 · tags: phoenix, module, heartbeat, tell-mom
next:
  - module/PhoenixCycle: its own door, owning the beat - interval in minutes, default 10, declared in node.json not in code
  - the cycle publishes node.<ref>.cycle with count, interval, since, uptime - and Core stops writing that branch (it becomes a reader)
  - an actions list that is empty by default and declared in data/actions.json: each action has name, when (every N cycles), what (http|command|event), and whether it needs a human
  - runnable by hand: POST /api/tick fires the list once without waiting, so an action can be tested before the beat is trusted
  - Tell Mom: the notify protocol - a cycle that has something to say raises one message to a declared channel (the operator first), with severity, what happened and what it wants
  - Tell Mom is a declaration too: channel, quiet hours, dedupe, and never more than one message per cycle
  - a cycle that fails an action reports it as a cycle outcome, not a silent skip - the operator sees a red beat in the LAN row
  - the beat survives a restart with its count intact (file, not memory), because a counter that resets every launch tells the operator nothing
  - displayed in the Menu: a small beat card beside Echidna - count, interval, next beat in, last outcome

### cdb81fd3 — Talk to Echidna: the Menu's mark becomes the conversation, the interface sits beside it

intent: Most people will never read five pages of agent output. The Menu's golden-layout div that holds the SVG logo becomes 'Talk to Echidna'; the right pane is an Easy Mode surface where the same work is buttons, pictures and one big question at a time. HTML is ADDITIONAL, never instead of the transcript.
deps: 0/0 · tags: menu, echidna, ui, easy-mode
next:
  - Menu: the div holding the SVG mark becomes the Echidna conversation; the mark stays small as the identity, the pane becomes the talk
  - the right pane is our interface: Easy Mode lives BESIDE the transcript, never instead of it - one page, two panes
  - transcript pane is an honest clone of a real Hermes session (turns, tool lines, timestamps) read from the session store, not a re-imagining
  - send path: one door shells 'hermes -z <prompt> --continue' against a named session (hydra-talk) and streams the reply into the transcript
  - cold start per message first; a long-lived agent process later - the door should not care which
  - Easy Mode buttons: a declared action list (data/actions.json: name, icon, url|command, risk) so 'launch what we talked about' is one tap - never an invented action
  - media: images, audio and video render inline at full width, one item big at a time with a strip of recent ones
  - questions: the agent asks ONE at a time, big type (>= 24px), options as rows to tap, free text as fallback - never a wall of text
  - optional STT: push-to-talk against a declared LAN whisper service; when none is declared the mic is absent, not broken
  - optional TTS: Echidna speaks through a declared LAN piper service, off by default, one speaker toggle; absent speaker when absent service
  - Easy Mode states what is missing ('no speech service declared on this LAN') rather than hiding the capability
  - the thread survives a restart (file on disk, not memory) because the operator closes the app between sessions
  - usable at 1024x600 with big hit targets - the old GPUs and 1050 laptops are the audience
  - karma and the queue are visible in the pane without leaving it: what was asked, what is running, what it cost

### c9c77ef1 — Tell Mom: one verb for telling the operator, with a policy and a receipt

intent: 'Tell Mom' is a verb any module can call - Phoenix Cycle first - that reaches the operator wherever they are. Channels are adapters: the Echidna pane always, Discord as the phone channel (outbound only, one HTTPS POST, no gateway). Nothing on Windows boot: everything lazily starts from the Hydra app, and a notification must survive that app being closed.
deps: 0/0 · tags: tellmom, module, notify, discord
next:
  - module/TellMom on :8139 in DOOR_TABLE, POST /api/tell {severity,subject,body,wants,dedupeKey,channels} - built this bite
  - policy in data/policy.json: dedupe window 900s, ceiling 6/hour, quiet hours that 'alert' may cross - built this bite
  - a receipt for every tell in data/told.jsonl + node.<ref>.told in State: sent, to where, deduped or failed - built this bite
  - NO Telegram anywhere: the operator does not want it - enforced in code and in comments
  - Discord outbound only: a declared channel id or a DM opened to DISCORD_ALLOWED_USERS[0]; nothing stays connected between messages
  - Phoenix Cycle calls Tell Mom when a cycle has something to say (the 10-minute beat's first action)
  - a Tell Mom that reached nothing must be visible: the pane shows the receipt line, and the LAN row carries the last tell
  - senders are declared too: which modules may tell, and at what ceiling - a runaway loop cannot page the phone
  - the operator can mute a subject without muting the module (a key, not a switch)
  - no secrets in the repo: the token is read from the Hermes .env at runtime and never echoed

### 0d6a276c — Broker: Discord as the free answer to double NAT, owned by one module

intent: The ISP puts this LAN behind double NAT, so nodes cannot reach each other directly from outside. Discord is the one free transport that gets through - and the operator gave up on running gateways per service. So one module owns the ONE Discord connection: it relays node-to-node messages (brokering), and Tell Mom borrows it for outbound notifications. No second listener, no per-module bot.
deps: 0/0 · tags: broker, discord, nat, module
next:
  - one module owns the Discord connection: outbound messages and (later) inbound reads, never one listener per module
  - Tell Mom is a CLIENT of the broker for the phone channel, not the owner of a token
  - node-to-node envelope over Discord: from, to, topic, body, id - so a remote node's answer is one message, not a protocol
  - pairing is declared: which Discord channel/DM belongs to which node ref, in the instance layer, not in code
  - inbound is opt-in per node: a box that only sends never opens a socket
  - what arrives is a fact in State (node.<ref>.broker.last) so the operator can see the wire is alive
  - a broker outage must not stop local work: everything local keeps running, and the backlog is reported not queued forever

also ready: 954deebc, f2e2deb0, 64a4cbb3, 2629893c, cd60ec6e, 291eac93, 8793886c, e093f426, 44ff5033, 49e30c7a, 8ff46a1b, daa96bc0, cdb81fd3, c9c77ef1, 0d6a276c

## Stuck, and why

- `04bf6852` Salvage main — marked blocked (blocked)
- `db39b286` Idle Service: the Scheduler decides when a node is idle — no next action recorded (open)
- `109e3f84` Prove sshd survives a cold start on main — waiting on 1 of 1 dependencies (active)
- `0e535747` Snapshot the ReadyNAS NV+ before archiving to it — waiting on 1 of 1 dependencies (active)
- `bfd6aba0` LAN view: Core publishes, Mirror reads, the Menu shows every node — waiting on 1 of 1 dependencies (active)
- `1e31aeda` An installer executes a service.json install block — waiting on 1 of 1 dependencies (active)
- `86fb7fea` Hydra V2 gains a verb layer over MCP (fleet_run, tts_speak, tot_file) — waiting on 1 of 1 dependencies (active)
- `a41a9db8` Wrap the voice engine as a Hydra V2 service — waiting on 2 of 2 dependencies (active)

## Files

- store: `thoughts.json` (hand editable, atomic writes)
- evidence: `thoughts/<ref>/` — one folder per node
- this brief: `frontier.md` / `frontier.json` (regenerated on every save)
