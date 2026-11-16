# PENDING MERGE — daily fleet sweep 2026-11-16 (from node 123)

This note could NOT be appended to the shared repo (\\192.168.1.100\Receive\deepseek\app\Hydra).
192.168.1.100 is HARD-OFFLINE for the 6th consecutive sweep (11-08, 11-09, 11-10, 11-11, 11-13, 11-16):
ICMP from 192.168.1.123 answers "Reply from 192.168.1.123: Destination host unreachable", there is no
ARP entry for .100, and /mcp plus /api/clients return 000 on every probe.

## THE ROOT CAUSE IS NOW KNOWN — read this first

Main was REBUILT on 2026-11-10 and its LAN address CHANGED from .100 to **192.168.1.106** (the wired
Realtek port is disconnected; it is on Wi-Fi via a TP-Link USB dongle). This is recorded in this box's
own roster note (C:\AI\fleet\roster.json, "main" entry), so the sweeps of 11-10 onward were polling an
address the box no longer uses. Probed today:

- 192.168.1.106 — UP, ping 1 ms, TTL 64. Ports **8111, 8127, 8136, 8137 and 445 are ALL CLOSED.**
  The box boots but has no Hydra app, no door and no file share running after the rebuild
  (roster: "NO Hydra app running and no door on 8127/8136 - managed:false until it is installed").
- 192.168.1.115 (JimsLaptop) — UP, door alive (:8127=200, :8136=404 alive, Mirror present), and the
  Mirror labels it **"jims - Jim's Laptop (acting main)"**. No :8111 server there either.
- No host on the LAN answers :8111. There is no failover Hydra server.

NEEDS-HUMAN: (1) decide whether the fleet server follows the rebuilt box to .106 or stays with
JimsLaptop; (2) install/start Hydra on that host (its door + :8111); (3) re-point this cron job's
URLs — .100:8111 and \\192.168.1.100\Receive are both dead addresses now, not a transient outage.
Nothing on this node can fix it: the server runs as scheduled task `hydra-server-visible` on Main and
only a Main session can start it.

The note number could not be counted against the shared OPERATOR-NOTES.md, and no commit was made to
the shared repo (it lives on the dead .100 host). A local commit of THIS file was made on 123's clone
(C:\AI\hydra-local) and pushed to origin (github.com/electriclief/hydra-v2), same as 11-13.

On Main's return: append into OPERATOR-NOTES.md (number it at that time) and Progress.md, then delete
this file.

## NOTE ? — daily fleet sweep 2026-11-16

- SERVER :8111 — FAIL (000 on 3 probes plus a 4-port sweep; .100 unreachable at the IP layer). Day 6.
  Root cause identified: the host moved to .106 on 11-10 and has no Hydra installed. See above.
  NEEDS-HUMAN, and the job definition needs its address corrected.
- FLEET /api/clients — SKIPPED (server offline). Substitute: 123's Mirror, 127.0.0.1:8137/api/lan.json
  at 2026-11-16T14:05Z — nodes 9, alive 7, services 29, ready 29, booked 0, declared 17, absent 7.
  Alive: `123` (.123), `1660`/gtx-1660 (.149), `jims`/JimsLaptop (.115, "acting main"), `robert`
  (.109), `ReX` (.148), `miner1` (.112), `Richard` (.137). Gone/stalled: `gvtx980` (.134, gone),
  `xpsw` (.142, stalled).
  Expected 6-online roster: Main **ABSENT** (host moved, see above), 123 online, Robert online,
  Gtx-1660 online, JimsLaptop online, **gtx-1050ti is not a client at all** — the roster puts the
  GTX 1050 Ti *inside* miner1 (192.168.1.112, three NVIDIA cards, ssh-monitored, no Hydra modules
  and no state door). The expected roster needs amending.
- 123:8080 llama-server — PASS 200 on arrival, no restart. PID 16468, `Qwen3.8-9B-Q8_0.gguf`,
  ctx 262144. (The job's `Qwen3.6-35B-A3B-UD-IQ3_S (1).gguf` is still absent from this disk; the
  11-13 fallback model is holding the port. llmctl's default still needs repointing — see 11-13.)
- 123:8081 Qwen2.5-VL — PASS 200 on arrival, no restart. PID 3208, `Qwen2.5-VL-7B-Instruct-Q5_K_S.gguf`
  + mmproj BF16, ctx 262144. (3 MB working set = lazy load with --no-mmap, not a dead process.)
- 123:8642 hermes gateway — PASS 200 on arrival, no restart.
- llama-server count on 123 — PASS, exactly 2 (16468=:8080, 3208=:8081).
- cfgverify.ps1 — PASS, BYTES=17258 NONASCII=0. fixcfg2.py not needed.
- 1660 door (/api/cmd) — SKIPPED, the door lives on the dead .100:8111.
- **1660 SSH fallback used instead** (the job says SSH is unreachable; it is not):
  `ssh -i ~/.ssh/id_ed25519_echidna User@192.168.1.149` works. `llmctl.ps1 -action status` returns
  `RUNNING pid=6160 port=8080 healthy=True ctx=131072`, model `gemma-4-E4B-it-Q5_K_M.gguf`, no mmproj.
- 1660:8080 gemma — PASS 200 on arrival, no restart.
- 1660:8642 gateway — PASS 200 on arrival, no restart.
- 1660 door :8127 — PASS 200 (also 123, robert, jims doors all 200; the LAN substrate is healthy).
- worker-completions — SKIPPED, nothing countable. \\192.168.1.100\Receive is dead; .106 has 445
  closed; .115 exposes no Receive share; `C:\Users\Leafdriving` does not exist on 123. 0 files
  counted, so anything filed since 11-13 is unseen. Main reviews on return.
- Git commit to shared repo — SKIPPED (repo lives on the dead share). Local commit on 123 pushed to
  origin as on 11-13.

Restarted: **0**. Nothing was broken on any reachable host: 123, 1660, robert and jims were all
healthy on arrival, so this sweep was read-only.

Progress.md line:
- [DONE] daily fleet sweep 2026-11-16: root cause of the 6-day "Main offline" saga found — the box was rebuilt on 11-10 and moved .100 -> .106, where it pings but runs no Hydra, no door and no SMB share, and no host on the LAN answers :8111; 123 8080/8081/8642 all 200 (2 llama-server, cfg NONASCII=0), 1660 gemma 8080 + gateway 8642 both 200 verified over SSH because the /api/cmd door is gone, 0 restarts; fleet via 123's Mirror is 9 nodes / 7 alive with Main and gtx-1050ti unaccounted for (the 1050 Ti is a card inside miner1, not a client); completions and the shared commit remain blocked, so the note is pending here
