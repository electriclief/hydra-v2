# PENDING MERGE — daily fleet sweep 2026-11-10 (from node 123)

This note could NOT be appended to the shared repo (\\192.168.1.100\Receive\deepseek\app\Hydra).
192.168.1.100 is HARD-OFFLINE for the 3rd consecutive sweep: ping from 192.168.1.123 returns
"Destination host unreachable", there is NO ARP entry for .100, TCP :445 / :8111 / :8127 / :8136 / :8137
all return 000, and the SMB share will not mount.
Control probes on the same NIC: gateway .1 replies 1 ms, .149 [1660] replies 1 ms, .108 [JimsLaptop] replies 483 ms.
So the outage is Main only, not this node's network.

Therefore the note number could not be counted against the shared OPERATOR-NOTES.md and no commit was
made to the shared repo. A local commit of THIS file only was made on 123's clone (C:\AI\hydra-local).

On Main's return: append into OPERATOR-NOTES.md (number it at that time) and Progress.md, then delete this file.

## NOTE ? — daily fleet sweep 2026-11-10

- SERVER :8111 — FAIL (000 on 2 probes, 8 s + 6 s timeouts). Cause: Main host 192.168.1.100 unreachable at the IP layer. NEEDS-HUMAN: power/boot the Main box, then in a Main session confirm scheduled task `hydra-server-visible` is running. This is day 3 of the same outage (11-08, 11-09, 11-10).
- FLEET /api/clients — SKIPPED (server offline). Substitute: this node's own Mirror, 127.0.0.1:8137/api/lan.json, sampled twice at 2026-11-10T14:04Z and again ~90 s later; the two snapshots disagreed (nodes 4/alive 3/declared 15 vs nodes 3/alive 1/declared 12), so per-node counts are UNSTABLE. Stable observations: node 123 = self with 5 services all ready; `jims` 192.168.1.127 and `robert` 192.168.1.109 publish state but list 0 services. The 6-online roster (Main, 123, Robert, Gtx-1660, JimsLaptop, gtx-1050ti) is UNVERIFIED — Main and gtx-1050ti are absent from the tree.
- 1660 PUBLISHING — WARN. 192.168.1.149 answers HTTP on 8080 (200) and 8642 (200) but its Hydra state/core/mirror ports 8127 / 8136 / 8137 all return 000, so the Mirror lists `gtx1660` under notHere/declaredAbsent even though the box is up. The 1660 is serving LLM traffic while contributing nothing to the fleet tree — that is a real hydra fault, not a network one.
- 123:8080 Qwen llama-server — PASS 200 on arrival, no restart. Same PID as yesterday (19576), so the process has now been up across two sweeps.
- 123:8081 Qwen2.5-VL — PASS 200 on arrival, no restart (PID 19908, also unchanged from 11-09).
- 123:8642 hermes gateway — PASS 200, no restart.
- llama-server count on 123 — PASS, exactly 2 (pid 19576 = :8080, pid 19908 = :8081).
- cfgverify.ps1 — PASS, BYTES=17064 NONASCII=0 (fixcfg2.py not needed; count unchanged from 11-09).
- 1660:8080 gemma — PASS 200 direct; /v1/models confirms gemma-4-E4B-it-Q5_K_M.gguf (no restart needed).
- 1660:8642 gateway — PASS 200 direct, hermes-agent 0.20.0 (no restart needed).
- 1660 door (/api/cmd → llmctl status) — SKIPPED, the door lives on Main's :8111 which is down. 1660 was healthy on both ports so no restart was needed; its llmctl status remains unread for a 3rd day.
- worker-completions — SKIPPED. UNC share \\192.168.1.100\Receive is dead and C:\Users\Leafdriving does not exist on 123. Nothing counted; any completions filed since 11-09 are unseen.
- Git commit to shared repo — SKIPPED (repo lives on the dead share).
- Local 123 actions this sweep — NONE. No service was down on this box, so no restart was issued.

Restarted: 0.

Progress.md line:
- [DONE] daily fleet sweep 2026-11-10: Main/192.168.1.100 hard-offline 3rd day (needs human); 123 8080/8081/8642 all up, 2 llama-server, cfg NONASCII=0; 1660 8080+8642 serving but publishing no Hydra state; door + completions + shared commit blocked by dead server host
