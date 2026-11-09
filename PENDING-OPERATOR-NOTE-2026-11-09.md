# PENDING MERGE — daily fleet sweep 2026-11-09 (from node 123)

This note could NOT be appended to the shared repo (\\192.168.1.100\Receive\deepseek\app\Hydra).
192.168.1.100 is HARD-OFFLINE again this run (2nd consecutive day): ping from 192.168.1.123 returns
"Destination host unreachable", there is NO ARP entry for .100, and TCP :445 times out.
(Control probes: gateway .1 replies, .149 [1660] replies 1 ms, .108 [JimsLaptop] does NOT reply.)
Therefore the note number could not be counted and no commit was made to the shared repo.

On Main's return: append into OPERATOR-NOTES.md (number it at that time) and Progress.md, then delete this file.

## NOTE ? — daily fleet sweep 2026-11-09

- SERVER :8111 — FAIL (000, 2 probes + 12 s timeout). Cause: Main host 192.168.1.100 unreachable at IP layer. NEEDS-HUMAN: power/boot the Main box, then in a Main session confirm scheduled task `hydra-server-visible` is running.
- SMB :445 (\\192.168.1.100\Receive) — FAIL, host offline, share not mountable.
- FLEET /api/clients — SKIPPED (server offline). Substitute: this node's Mirror 127.0.0.1:8137/api/lan.json at 2026-11-09T14:07:41Z — declared 15, onLan 3, notHere 12 (main, gtx1660, gvtx980, beast, ReX, XPS, XPSW, andrewjames, deadalus, X120e, miner1, miner2); nodes 3 / alive 2 / services 12 / ready 12. The 6-online roster (Main, 123, Robert, Gtx-1660, JimsLaptop, gtx-1050ti) is UNVERIFIED.
- 123:8080 — RESTARTED. Was DOWN on arrival (000) and no llama-server existed; the staged model "Qwen3.6-35B-A3B-UD-IQ3_S (1).gguf" is STILL not on disk (3rd sweep running). Started the llmctl default instead: Qwen3.8-9B-Q8_0.gguf, now PASS 200.
- 123:8081 Qwen2.5-VL — RESTARTED. Was DOWN on arrival (000); started Qwen2.5-VL-7B-Instruct-Q5_K_S.gguf, PASS 200 (503 "loading" for ~90 s, then model loaded).
- 123:8642 hermes gateway — PASS 200 on arrival (no restart). Note it stayed up while its brain on 8080 was down.
- llama-server count on 123 — PASS, exactly 2 (pid 19576 = :8080, pid 19908 = :8081).
- cfgverify.ps1 — PASS, BYTES=17064 NONASCII=0 (fixcfg2.py not needed).
- 1660:8080 gemma — PASS 200 direct; /v1/models confirms gemma-4-E4B-it-Q5_K_M.gguf (no restart).
- 1660:8642 gateway — PASS 200 direct (no restart).
- 1660 door (/api/cmd → llmctl status) — SKIPPED, the door lives on Main's :8111 which is down. 1660 was healthy on both ports so no restart was needed; its llmctl status remains unread.
- worker-completions — SKIPPED, UNC share (and C:\Users\Leafdriving) unreachable/nonexistent on 123. Nothing counted.
- Git commit to shared repo — SKIPPED, repo lives on the dead share.

Restarted: 2 — 123:8080 (Qwen3.8-9B-Q8_0.gguf) and 123:8081 (Qwen2.5-VL-7B-Instruct-Q5_K_S.gguf).

Progress.md line:
- [DONE] daily fleet sweep 2026-11-09: Main/192.168.1.100 hard-offline 2nd day (needs human); 123 8080+8081 were down, both restarted, 8642 up; 2 llama-server, cfg NONASCII=0; 1660 8080/8642 pass; door + completions + shared commit blocked by dead server host
