# PENDING MERGE — daily fleet sweep 2026-11-13 (from node 123)

This note could NOT be appended to the shared repo (\\192.168.1.100\Receive\deepseek\app\Hydra).
192.168.1.100 is HARD-OFFLINE for the 5th consecutive sweep (11-08, 11-09, 11-10, 11-11, 11-13):
ping from 192.168.1.123 returns "Request timed out", there is NO ARP entry for .100, and /mcp plus
/api/clients both return 000. The LAN itself is healthy — gateway .1 answers <1 ms, .149 (1660)
answers 17 ms with State/Core/Mirror all up, .108 (JimsLaptop) answers 121-153 ms. So the outage is
Main only: the box is off or unplugged.

The note number could not be counted against the shared OPERATOR-NOTES.md, and no commit was made to
the shared repo. A local commit of THIS file was made on 123's clone (C:\AI\hydra-local).

On Main's return: append into OPERATOR-NOTES.md (number it at that time) and Progress.md, then delete
this file.

## NOTE ? — daily fleet sweep 2026-11-13

- SERVER :8111 — FAIL (000 on three probes; host unreachable at IP layer). Day 5 of the same outage.
  NEEDS-HUMAN: power/boot the Main box, then in a Main session confirm scheduled task
  `hydra-server-visible` is running. No :8111 listener exists anywhere on the LAN (probed .100, .108,
  .104, .111) — there is no failover server.
- FLEET /api/clients — SKIPPED (server offline). Substitute: this node's Mirror,
  127.0.0.1:8137/api/lan.json at 2026-11-13T14:12Z — nodes 6, alive 6, services 40, ready 40,
  declared 17, absent 10. On-LAN: `123`, `1660` (gtx-1660), `gvtx980` (gtx-980ti), `jims`
  (JimsLaptop, labelled "acting main"), `robert`, `xpsw` (Dell XPS 8300 / GTX 1060).
  Expected 6-online roster UNVERIFIED: `main` absent (host off) and `gtx-1050ti` absent from the tree;
  `gvtx980` and `xpsw` are online but are not on the job's expected list.
- 123:8080 llama-server — FAIL on arrival (000, no llama-server.exe at all). RESTARTED. The job's
  model `Qwen3.6-35B-A3B-UD-IQ3_S (1).gguf` is NOT on this disk (llmctl: "ERROR: model not found";
  no *35B* gguf anywhere under C:\Users\User\Desktop\llms or C:\AI\models), so I started the largest
  chat model that does exist: `Qwen3.8-9B-Q8_0.gguf`, ctx 262144, text-only (its 27B mmproj is also
  missing). Healthy 200, PID 15576. NEEDS-HUMAN: confirm the intended 8080 brain — if the 35B was
  deleted on purpose, llmctl's default should be repointed at Qwen3.8-9B so the next sweep stops
  reporting a missing model.
- 123:8081 Qwen2.5-VL — FAIL on arrival (000). RESTARTED with `Qwen2.5-VL-7B-Instruct-Q5_K_S.gguf`
  + mmproj BF16, healthy 200 after ~50 s, PID 7716.
- 123:8642 hermes gateway — PASS 200 on arrival, no restart.
- llama-server count on 123 — PASS, exactly 2 (15576 = :8080, 7716 = :8081).
- cfgverify.ps1 — PASS, BYTES=17258 NONASCII=0 (fixcfg2.py not needed).
- 1660 door (/api/cmd) — SKIPPED, the door lives on Main's :8111 which is down.
- 1660 REACHABILITY — PASS. Ping 2/2 from 123 (17 ms); State :8127 = 200, Core :8136 = 404 on `/`
  (alive), Mirror :8137/api/lan.json = 200; uptime 129401 s (~36 h, so it rebooted on 11-11 evening);
  doors 10/16 up; standby idle, no GPU work booked.
- **1660 SSH fallback used again** — `ssh -i ~/.ssh/id_ed25519_echidna User@192.168.1.149` works
  (hostname DESKTOP-5NN77TL). Remote default shell is PowerShell 5.1: use `;` not `&&`, and scripts
  need `-ExecutionPolicy Bypass` (execution policy is Restricted for -File).
- 1660:8080 gemma — FAIL on arrival (000, "llama-server NOT running on port 8080"). RESTARTED via
  SSH: `llmctl.ps1 -action start -model gemma-4-E4B-it-Q5_K_M.gguf -port 8080`. THIS TIME IT WORKED —
  `query user` shows an active console session (user, ID 1, logged on 2026-11-11 21:11), so the
  interactive task `hydra-llm-visible` actually launched. Healthy 200 in ~40 s, PID 6160, running in
  console session 1 (visible, so it complies with the operator's no-invisible-daemon rule).
- 1660:8642 gateway — FAIL on arrival (000). RESTARTED via SSH after the brain was healthy:
  `hermesctl.ps1 -action start`. Healthy 200 within 10 s.
- NOTE ON THE 1660 FIX: the 11-11 failure was not a broken launcher, it was "nobody logged on at the
  console". It recovered because an interactive session is now live on that box. It will die again
  the moment that session ends — the durable repair is autologon (or ProcessWrapper), not a task
  conversion.
- worker-completions — SKIPPED. UNC \\192.168.1.100\Receive is dead and C:\Users\Leafdriving does
  not exist on 123. 0 files counted; anything filed since 11-11 is unseen.
- Git commit to shared repo — SKIPPED (repo lives on the dead share). Local commit on 123 only.

Restarted: 4 successful — 123:8080 (fallback model), 123:8081 (VL), 1660:8080 (gemma), 1660:8642.

Progress.md line:
- [DONE] daily fleet sweep 2026-11-13: Main/192.168.1.100 off for the 5th day (needs human; no :8111 anywhere on LAN); 123 8080/8081/8642 restored (8080 on Qwen3.8-9B — the 35B gguf is gone), 2 llama-server, cfg NONASCII=0; 1660 LLM 8080 + gateway 8642 both DOWN and both RESTARTED over SSH because an active console session finally let the interactive launchers fire; completions and shared commit still blocked by the dead server host
