# PENDING MERGE — daily fleet sweep 2026-11-07 (from node 123)

This note could NOT be appended to the shared repo (\\192.168.1.100\Receive\deepseek\app\Hydra)
because Main's host 192.168.1.100 answers ping but has NO listening service reachable:
:8111 returns no response (000/timeout) and SMB :445 is refused — the share is not mountable.
Therefore the note number could not be counted and no commit was made.

On Main's return: append this into OPERATOR-NOTES.md (number it at that time) and Progress.md,
then delete this file.

## NOTE ? — daily fleet sweep 2026-11-07

- SERVER :8111 — FAIL (192.168.1.100 pings, ICMP 2/2 replies, but TCP :8111 refused/timed out over 4 attempts across ~4 min; hydra server DOWN). NEEDS-HUMAN: only a Main session can restart scheduled task hydra-server-visible.
- SMB :445 (\\192.168.1.100\Receive) — FAIL, refused. Share unmountable, so Steps 4 and 5 could not run.
- FLEET /api/clients — SKIPPED (server offline, no client list obtainable; 6-online count unverified).
- 123:8080 Qwen3.8-9B-Q8_0 — PASS 200 on arrival (pid 12420). No restart.
- 123:8081 Qwen2.5-VL-7B-Instruct-Q5_K_S — PASS 200 on arrival (pid 11092). No restart.
- 123:8642 hermes gateway — PASS 200 (hermes-agent 0.22.5). No restart.
- llama-server count on 123 — PASS, exactly 2 (12420, 11092).
- cfgverify.ps1 — PASS, BYTES=17066 NONASCII=0 (fixcfg2.py not needed).
- 1660:8080 gemma — PASS 200 (direct).
- 1660:8642 gateway — PASS 200 (direct).
- 1660 door (/api/cmd llmctl status) — SKIPPED, door requires Main's :8111.
- worker-completions — SKIPPED, UNC share unreachable.

Restarted: none. Nothing on 123 or 1660 needed a restart.

Deviation carried over from 2026-11-05: the sweep's requested 8080 model
"Qwen3.6-35B-A3B-UD-IQ3_S (1).gguf" is still NOT on disk; 8080 runs Qwen3.8-9B-Q8_0.gguf.
Update the sweep command or restore the model file.

Progress.md line:
- [DONE] daily fleet sweep 2026-11-07: Main/8111 + SMB offline (needs human); 123 8080/8081/8642 all pass, 2 llama-server; 1660 8080/8642 pass; completions unreadable
