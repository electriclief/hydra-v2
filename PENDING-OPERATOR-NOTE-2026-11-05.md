# PENDING MERGE — daily fleet sweep 2026-11-05 (from node 123)

This note could NOT be appended to the shared repo (\\192.168.1.100\Receive\deepseek\app\Hydra)
because Main's host 192.168.1.100 is OFFLINE (ping: destination host unreachable;
:8111 no response; SMB share not mountable). Append this into OPERATOR-NOTES.md and
Progress.md, then delete this file, when Main is back.

## NOTE N — daily fleet sweep 2026-11-05

- SERVER :8111 — FAIL (host 192.168.1.100 unreachable, needs-human restart of hydra-server-visible on Main)
- FLEET /api/clients — SKIPPED (server offline, no client list obtainable)
- 123:8080 Qwen3.8-9B-Q8_0 — FAIL on arrival -> RESTARTED -> PASS 200 (pid 11428)
- 123:8081 Qwen2.5-VL-7B-Instruct-Q5_K_S — FAIL on arrival -> RESTARTED -> PASS 200 (pid 4564)
- 123:8642 hermes gateway — PASS 200 (no restart needed)
- llama-server count on 123 — PASS, exactly 2 (11428:8080, 4564:8081); two orphans killed first
- cfgverify.ps1 — PASS, BYTES=17066 NONASCII=0 (no fixcfg2.py run needed)
- 1660:8080 gemma — PASS 200 (direct)
- 1660:8642 gateway — PASS 200 (direct)
- 1660 door (/api/cmd) — SKIPPED, door requires Main's :8111
- worker-completions — SKIPPED, UNC share unreachable

Restarted: 8080 Qwen3.8-9B-Q8_0, 8081 Qwen2.5-VL-7B-Instruct-Q5_K_S.
Deviation: requested 8080 model "Qwen3.6-35B-A3B-UD-IQ3_S (1).gguf" is NOT on disk
(only Bonsai-1.7B, Qwen2.5-VL-7B-Instruct-Q5_K_S, Qwen3.8-9B-Q8_0). Started llmctl default
Qwen3.8-9B-Q8_0.gguf. Update the sweep command or restore the model file.

Observed llmctl bug: two concurrent `start` invocations on the same port leave two
llama-server processes bound to one port (seen on 8080 and 8081). Fix: `stop` the port,
confirm zero listeners, start once, then wait for /health.

Progress.md line:
- [DONE] daily fleet sweep 2026-11-05: Main/8111 offline (needs human); restarted 123 8080+8081; 1660 healthy; completions unreadable
