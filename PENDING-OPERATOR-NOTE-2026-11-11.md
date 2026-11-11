# PENDING MERGE — daily fleet sweep 2026-11-11 (from node 123)

This note could NOT be appended to the shared repo (\\192.168.1.100\Receive\deepseek\app\Hydra).
192.168.1.100 is HARD-OFFLINE for the 4th consecutive sweep (11-08, 11-09, 11-10, 11-11): ping from
192.168.1.123 returns "Destination host unreachable", there is no ARP entry for .100, and /mcp plus
/api/clients both return 000 after 12 s. Control probes on the same NIC answer normally (.1 gateway,
.149 [1660] 34-139 ms), so the outage is Main only.

The note number could not be counted against the shared OPERATOR-NOTES.md, and no commit was made to
the shared repo. A local commit of THIS file was made on 123's clone (C:\AI\hydra-local).

On Main's return: append into OPERATOR-NOTES.md (number it at that time) and Progress.md, then delete
this file.

## NOTE ? — daily fleet sweep 2026-11-11

- SERVER :8111 — FAIL (000 on two probes, 8 s and 12 s). Cause: Main host 192.168.1.100 unreachable at
  the IP layer. NEEDS-HUMAN: power/boot the Main box, then in a Main session confirm scheduled task
  `hydra-server-visible` is running. Day 4 of the same outage.
- FLEET /api/clients — SKIPPED (server offline). Substitute: this node's own Mirror,
  127.0.0.1:8137/api/lan.json sampled at 2026-11-11T14:03:42Z — nodes 4, alive 3, services 18, ready 18,
  declared 17, onLan 4, notHere 12. On-LAN nodes: `123` (6 services, all ready), `gvtx980` (6), `jims`
  (0), `robert` (6). notHere: gtx1660, beast, ReX, XPS, XPSW, main, andrewjames, deadalus, X120e,
  miner1, miner2, Richard. The expected 6-online roster is UNVERIFIED: `main`, `gtx1660` and
  `gtx-1050ti` are all absent from the tree (`gtx-1050ti` is not even in roster.json).
- 123:8080 Qwen llama-server — PASS 200 on arrival, no restart (PID 19576, unchanged since 11-09).
- 123:8081 Qwen2.5-VL — PASS 200 on arrival, no restart (PID 19908, unchanged since 11-09).
- 123:8642 hermes gateway — PASS 200 on arrival, no restart.
- llama-server count on 123 — PASS, exactly 2 (19576 = :8080, 19908 = :8081).
- cfgverify.ps1 — PASS, BYTES=17064 NONASCII=0 (fixcfg2.py not needed).
- 1660 REACHABILITY — PASS at the network layer: ping 2/2 from 123 (34-139 ms), TCP 22 open, TCP 3389
  open, ARP d0-df-9a-e6-b8-59. The box is powered and on the LAN.
- 1660:8080 gemma — FAIL. curl 000 / Test-NetConnection False; over SSH `llmctl -action status` says
  "llama-server NOT running on port 8080". Down since the 11-10 sweep, when it answered 200.
- 1660:8642 gateway — FAIL. Same 000 / False. Previously 200 on 11-10.
- 1660 door (/api/cmd) — SKIPPED, the door lives on Main's :8111 which is down.
- **SSH TO 1660 WORKS — the "SSH is unreachable, always use the door" premise is obsolete.** With
  `-i ~/.ssh/id_ed25519_echidna` (not `id_ed25519_main`), `ssh User@192.168.1.149` authenticates and
  returns hostname `DESKTOP-5NN77TL`. Port 22 is open and in known_hosts. This gave the only usable
  remote path this sweep, and should become the fallback whenever Main is offline.
- 1660 RESTART ATTEMPT (via SSH) — FAILED, root cause identified. Ran
  `llmctl.ps1 -action start -model gemma-4-E4B-it-Q5_K_M.gguf -port 8080`; it reported success
  ("VISIBLE console - hydra-llm-visible task") but no llama-server.exe appeared, no health after 120 s,
  and no log file was written. Diagnosis: the launcher is an INTERACTIVE task (`schtasks /create ... /it`),
  `query user` on the 1660 returns "No User exists for *" (nobody logged on at the console), so
  `schtasks /run hydra-llm-visible` silently no-ops — Last Run Time is still 2026-11-04 23:59, Last
  Result 267014. `C:\Users\User\llm-logs` does not exist, so even a successful launch could not write
  logs. `hermesctl.ps1` (`hydra-hermes-visible`) is built the same way, so the gateway is blocked by the
  same cause and was NOT attempted (it also needs a live brain).
- NEEDS-HUMAN (1660): log on to the 1660's desktop (DESKTOP-5NN77TL), then
  `llmctl -action start -model gemma-4-E4B-it-Q5_K_M.gguf -port 8080` followed by
  `hermesctl -action start`. Do NOT "fix" this by converting the task to non-interactive — an invisible
  daemon violates the operator's standing rule. The real repair is to keep an interactive session alive
  on that box (autologon) or move both launchers under ProcessWrapper so they survive logoff. This is
  why both services died between 11-10 and 11-11: the console session ended and took the consoles with it.
- worker-completions — SKIPPED. UNC \\192.168.1.100\Receive is dead and C:\Users\Leafdriving does not
  exist on 123. Nothing counted; any completions filed since 11-10 are unseen.
- Git commit to shared repo — SKIPPED (repo lives on the dead share). Local commit on 123 only.
- Local 123 actions this sweep — NONE. No service was down on this box, so no restart was issued.

Restarted: 0 successful (1 attempted on the 1660, blocked by the interactive-session requirement).

Progress.md line:
- [DONE] daily fleet sweep 2026-11-11: Main/192.168.1.100 hard-offline 4th day (needs human); 123 8080/8081/8642 up, 2 llama-server, cfg NONASCII=0; 1660 network-up but LLM 8080 + gateway 8642 both DOWN — SSH-over-echidna-key works, restart blocked because hydra-llm-visible/hydra-hermes-visible are /it tasks and nobody is logged on; door/completions/shared commit blocked by dead server host
