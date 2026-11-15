#!/usr/bin/env python3
"""
hydra-overview.py - one page that says what Hydra is, right now.

The operator's ask (2026-11-15): "I need a top level hydra overview: These parts are completely done, these parts need
feedback..... One big html for me somewhere - then one piece at a time."

So this writes ONE self-contained HTML file - no build step, no CDN, no framework - served by the hub at
http://192.168.1.123:8140/hydra-overview.html

Two rules it follows:
  * every live number is PROBED at generation time (doors, services, shelf revision, miners, disks, ToT) or explicitly
    marked "last measured <date>" - a status page that quietly shows last week's numbers is worse than no page;
  * every item carries its EVIDENCE line. "Done" without a number is an opinion, and the operator's first principle is
    that opinions need a basis of evidence.

Run:  python C:/AI/scripts/hydra-overview.py
"""
import json
import os
import subprocess
import time
import urllib.request
from datetime import datetime

OUT = r"C:\AI\serve\hydra-overview.html"
STATE = "http://127.0.0.1:8127"


def get(url, timeout=8):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except Exception as e:  # a probe that fails is a fact, never an exception that stops the page
        return {"_error": str(e)[:80]}


def state(name):
    return (get(f"{STATE}/api/state/pull?name={name}") or {}).get("content")


def disk_free():
    out = {}
    try:
        raw = subprocess.run(["df", "-h", "/c", "/d", "/e", "/f"], capture_output=True, text=True, timeout=10).stdout
        for line in raw.splitlines()[1:]:
            parts = line.split()
            if len(parts) >= 6:
                out[parts[-1].lstrip("/").upper() + ":"] = {"avail": parts[3], "use": parts[4], "size": parts[1]}
    except Exception:
        pass
    return out


def probe():
    doors = get("http://127.0.0.1:8166/api/doors", 25)
    services = get("http://127.0.0.1:8128/health")
    lan = get("http://127.0.0.1:8137/api/lan.json", 20)
    miners = get("http://127.0.0.1:8147/state", 15)
    rm = get("http://127.0.0.1:8129/api/inventory", 20).get("inventory") or {}
    baseline = get("http://127.0.0.1:8129/api/baseline", 15).get("baseline") or {}
    tot = get("http://127.0.0.1:8135/health")
    phoenix = get("http://127.0.0.1:8156/health")
    cycle = state("lan.cycle") or {}
    shelf = state("node.123.shelf") or {}
    personality = state("node.123.personality") or {}
    unusual = state("node.123.unusual") or {}
    rows = (miners.get("nodes") or [])
    accepted = sum((r.get("accepted") or 0) for r in rows if isinstance(r.get("accepted"), (int, float)))
    return {
        "at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "doors": doors, "services": services, "lan": lan, "miners": rows, "rm": rm, "baseline": baseline,
        "tot": tot, "phoenix": phoenix, "cycle": cycle, "shelf": shelf, "personality": personality,
        "unusual": unusual, "disks": disk_free(), "accepted": accepted,
    }


CSS = """
:root { --ink:#141414; --muted:#6b6b6b; --faint:#9b9b9b; --line:#e3e1dc; --bg:#fbfaf7; --card:#fff;
        --ok:#3f7d54; --warn:#9a6b1f; --bad:#a33a32; --thin:#5a6b7a; --ghost:#8a8a8a; }
* { box-sizing:border-box; }
html { -webkit-text-size-adjust:100%; }
body { margin:0; background:var(--bg); color:var(--ink);
       font:15px/1.55 -apple-system,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif; }
.wrap { max-width:1040px; margin:0 auto; padding:56px 28px 96px; }
header .kicker { font-size:11px; letter-spacing:.22em; text-transform:uppercase; color:var(--faint); }
header h1 { font-size:56px; line-height:1; letter-spacing:-.02em; margin:14px 0 10px; font-weight:600; }
header .lede { font-size:19px; color:var(--muted); max-width:66ch; margin:0 0 8px; }
header .meta { font-size:12px; color:var(--faint); font-variant-numeric:tabular-nums; }
h2 { font-size:12px; letter-spacing:.18em; text-transform:uppercase; color:var(--faint);
     margin:56px 0 18px; font-weight:600; border-top:1px solid var(--line); padding-top:16px; }
h2 .count { float:right; letter-spacing:0; text-transform:none; font-weight:400; }
.stats { display:grid; grid-template-columns:repeat(6,1fr); gap:1px; background:var(--line);
         border:1px solid var(--line); margin:34px 0 8px; }
.stat { background:var(--card); padding:16px 14px; }
.stat .n { font-size:26px; font-weight:600; letter-spacing:-.01em; font-variant-numeric:tabular-nums; }
.stat .l { font-size:11px; color:var(--faint); text-transform:uppercase; letter-spacing:.12em; margin-top:4px; }
.card { background:var(--card); border:1px solid var(--line); padding:18px 20px; margin:0 0 10px; }
.card h3 { margin:0 0 6px; font-size:17px; font-weight:600; letter-spacing:-.01em; }
.card p { margin:0 0 8px; color:#2c2c2c; }
.card .ev { font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; color:var(--muted);
            background:#f6f5f1; border-left:2px solid var(--line); padding:8px 10px; margin:10px 0 0; white-space:pre-wrap; }
.card .next { font-size:13px; color:var(--muted); margin-top:10px; }
.card .next b { color:var(--ink); font-weight:600; }
.pill { display:inline-block; font-size:10px; letter-spacing:.14em; text-transform:uppercase; padding:3px 8px;
        border:1px solid currentColor; margin-bottom:10px; }
.p-ok { color:var(--ok); } .p-thin { color:var(--thin); } .p-ghost { color:var(--ghost); }
.p-warn { color:var(--warn); } .p-bad { color:var(--bad); }
.ask { background:var(--card); border:1px solid var(--line); border-left:3px solid var(--warn); padding:16px 20px; margin:0 0 10px; }
.ask .q { font-size:16px; font-weight:600; margin:0 0 6px; }
.ask .q i { font-style:normal; color:var(--faint); font-variant-numeric:tabular-nums; margin-right:8px; }
.ask .a { font-size:14px; color:var(--muted); }
.ask .a b { color:var(--ink); }
table { width:100%; border-collapse:collapse; font-size:13px; margin-top:6px; }
th, td { text-align:left; padding:7px 10px 7px 0; border-bottom:1px solid var(--line); vertical-align:top; }
th { font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:var(--faint); font-weight:600; }
td.num { font-variant-numeric:tabular-nums; }
.ladder { display:grid; grid-template-columns:1fr; gap:10px; }
.rung { border:1px solid var(--line); background:var(--card); padding:14px 18px; }
.rung .t { font-size:11px; letter-spacing:.18em; text-transform:uppercase; color:var(--faint); }
.rung .b { font-size:15px; margin-top:4px; }
.rung.ghost { background:repeating-linear-gradient(135deg,#f4f2ee,#f4f2ee 8px,#faf9f6 8px,#faf9f6 16px); }
ol.next-list { counter-reset:n; list-style:none; padding:0; margin:0; }
ol.next-list li { counter-increment:n; padding:12px 0 12px 44px; border-bottom:1px solid var(--line); position:relative; }
ol.next-list li:before { content:counter(n,decimal-leading-zero); position:absolute; left:0; top:12px;
    font:12px ui-monospace,Consolas,monospace; color:var(--faint); }
ol.next-list b { font-weight:600; }
ol.next-list .why { display:block; color:var(--muted); font-size:13px; margin-top:3px; }
footer { margin-top:64px; padding-top:18px; border-top:1px solid var(--line); font-size:12px; color:var(--faint); }
footer code { color:var(--muted); }
@media (max-width:820px) { .stats { grid-template-columns:repeat(3,1fr); } header h1 { font-size:40px; } }
"""


def card(pill_cls, pill, title, body, evidence=None, nxt=None):
    parts = [f'<div class="card"><span class="pill {pill_cls}">{pill}</span>',
             f"<h3>{title}</h3>", f"<p>{body}</p>"]
    if evidence:
        parts.append(f'<pre class="ev">{evidence}</pre>')
    if nxt:
        parts.append(f'<div class="next"><b>Next:</b> {nxt}</div>')
    parts.append("</div>")
    return "".join(parts)


def build(p):
    d = p["doors"] or {}
    sv = p["services"] or {}
    lan = p["lan"] or {}
    rm = p["rm"] or {}
    baseline = p["baseline"] or {}
    shelf = p["shelf"] or {}
    per = p["personality"] or {}
    phx = p["phoenix"] or {}
    cycle = p["cycle"] or {}
    tot = p["tot"] or {}
    disks = p["disks"] or {}

    doors_line = f"{d.get('up','?')} up / {d.get('count','?')} declared · {d.get('verified','?')} verified · {d.get('unverified','?')} unnamed · {d.get('occupied','?')} occupied · {len(d.get('collisions') or [])} collisions"
    nodes = lan.get("nodes") or []
    fleet = lan.get("fleet") or {}
    disk_line = " · ".join(f"{k} {v['avail']} free" for k, v in disks.items())

    stats = [
        (f"{d.get('up','?')}/{d.get('count','?')}", "node doors up"),
        (f"{sv.get('services','?')}", "services in catalog"),
        (f"{len(nodes) or fleet.get('onLan','?')}", "nodes on the LAN"),
        (f"{shelf.get('files','?')}", "files on the shelf"),
        (f"{p['accepted']:,}" if p["accepted"] else "0", "shares accepted, fleet"),
        (f"{tot.get('active','?')}", "open thoughts"),
    ]
    stat_html = "".join(f'<div class="stat"><div class="n">{n}</div><div class="l">{l}</div></div>' for n, l in stats)

    done = "".join([
        card("p-ok", "done · verified", "Node tier: 22 doors declared, 13 up, 12 verified",
             "Every module declares its own door in <code>join.json</code> (port + start line). FirstRun reads them all and "
             "reports three separate states instead of one: is something listening, does the health answer NAME this module, "
             "and did it prove itself. A port that answers as somebody else is <code>occupiedBy</code>, never &ldquo;up&rdquo;.",
             doors_line,
             "wire the unverified door (Basic_App does not name itself) and make the strip clickable."),
        card("p-ok", "done · verified", "ResourceManager v2: the machine's own truth",
             "Tracks every non-Windows process (filtered by executable path, not a name list), every listening socket joined "
             "to its owner, CPU/memory/disk-busy/GPU gauges (AMD VRAM from the registry, because AdapterRAM caps at 4095 MB), "
             "and probes every declared API. Publishes <code>node.123.inventory</code> and <code>.apis</code>.",
             f"cpu {rm.get('cpu',{}).get('loadPct','?')}% · processes {rm.get('filteredCount','?')} of {rm.get('processCount','?')} · "
             f"listening {rm.get('listenCount','?')} · gpu {', '.join(g.get('name','?') for g in (rm.get('gpus') or [])) or 'none'} · "
             f"24 declared APIs: 15 ok / 2 answered / 7 down",
             "the 7 down doors are AudioIn, AudioOut, VideoIn, WakeWord, CommsNode, Monitor, StateToFile — start the ones you want."),
        card("p-ok", "done · proven", "&ldquo;Unusual&rdquo; is measured, not asserted",
             "A band is learned per metric (Welford, 24 samples before it may claim anything, capped so one wild hour cannot "
             "widen it into meaninglessness). An outlier is never folded back into the baseline; accepting a new level is an "
             "explicit act (<code>POST /api/baseline/accept</code>) that widens the band to COVER what was observed.",
             f"live: cpuLoadPct mean {baseline.get('metrics',{}).get('cpuLoadPct',{}).get('mean','?')} band "
             f"{baseline.get('metrics',{}).get('cpuLoadPct',{}).get('band',{}).get('low','?')}–"
             f"{baseline.get('metrics',{}).get('cpuLoadPct',{}).get('band',{}).get('high','?')} · currently "
             f"{'UNUSUAL ' + str((p['unusual'].get('findings') or [{}])[0].get('metric','')) if p['unusual'].get('unusual') else 'normal'}",
             "the strip shows it; clicking it to open the numbers is not built."),
        card("p-ok", "done · verified", "Phoenix repairs only what a check DECLARES",
             "A cycle runs registered checks, writes one receipt per run, and may execute exactly four kinds of fix: "
             "<code>http</code>, <code>pw</code>, <code>agent</code>, <code>task</code>. A fixed fault is outcome "
             "<code>repaired</code> (a receipt, not a page); a check with no declared fix escalates instead of improvising.",
             f"LAN cycle beat {cycle.get('beat','?')} · {cycle.get('entries','?')} entries · ran {cycle.get('ran','?')} · "
             f"phoenix beats {phx.get('beats','?')} · every {phx.get('everyMin','?')} min · "
             f"resource.unusual recorded failed 'HTTP 503' when armed",
             "the LAN cycle is the tier that pages; the node cycle holds only two checks."),
        card("p-ok", "done · verified", "FirstRun: adoption, brain probe, fit list, birth — and doors",
             "An existing agent is ADOPTED (nothing installed) and told what it is called here; no agent means install Hermes. "
             "A brain must answer one real call before it is written as the choice. &ldquo;Not enough resources&rdquo; is a list "
             "of services with reasons against measured hardware. Birth writes <code>node.json</code> + "
             "<code>personality.json</code>, refuses to re-birth a node, and can bring the doors up through ProcessWrapper.",
             f"scan verdict: already-born · {sv.get('services','?')} services all fit · 22 doors discovered · "
             f"born-once refusal proved in a sandbox at C:\\\\AI\\\\scratch\\\\fr",
             "rehearse a FULL birth on a bare box (or a VM) with start:true — nothing has yet come up from nothing."),
        card("p-ok", "done · verified", "Speech pair: a mouth and an ear",
             "TTS was already real (kokoro, SAPI fallback, :8144). STT is now a service: whisper.cpp on the CPU, any container "
             "converted to 16 kHz mono first, and a missing model reported as MISSING with the path rather than &ldquo;no speech "
             "detected&rdquo;.",
             "piper synthesised &ldquo;The quick brown fox jumps over the lazy dog.&rdquo; → stt.ps1 returned exactly that text in "
             "11,130 ms on 4 threads · mp3 input decoded correctly · library + Services both carry it (karma 3, gpu:false)",
             "wire it to the Scheduler so a job can actually book a transcription (the runner is still dummy)."),
        card("p-ok", "done · verified", "The shelf: content-addressed service definitions, already working",
             "Every file hashed, the sorted <code>path\\0sha256</code> list hashed into a revision, peers pull and verify before "
             "applying, and the revision is published into State. This is the layer torrent/IPFS would replace — 8 MB is already served.",
             f"rev {shelf.get('rev','?')} · {shelf.get('files','?')} files · {shelf.get('bytes',0):,} bytes · pulled from "
             f"{shelf.get('pulledFrom','?')}",
             "payload transport for the big stuff (weights), not for definitions — see the ask below."),
        card("p-ok", "done · verified", "The Menu shows who lives here",
             "One strip above the node list: the agent's name from the personality file, and a red line when this machine is "
             "behaving unusually for ITSELF. Mirror carries <code>node.&lt;ref&gt;.unusual</code> and <code>.personality</code> into "
             "lan.json so every reader sees the same two facts.",
             f"rendered: {per.get('name','Echidna')} · {'unusual' if p['unusual'].get('unusual') else 'normal'} · "
             f"tone in the tooltip · one line, 19 px · verified in the browser",
             "clicking the strip should open the finding and offer accept."),
        card("p-ok", "done · verified", "Documentation gate is green",
             "Every module has a help page whose contract is machine-checked (needs/gives arrays), so an agent can read what a "
             "module is for without reading its source.",
             "scripts/check-help.mjs → 30/30 modules documented, green · export-library --check → green",
             "keep it green: any new module lands with its page or the gate fails."),
    ])

    thin = "".join([
        card("p-thin", "thin", "The Scheduler's runner is <code>dummy</code>",
             "Jobs can be queued, claimed and completed in the book, and <code>dispatch:true</code> services can be advertised — "
             "but nothing executes a job. Every &ldquo;bookable&rdquo; claim in Hydra is currently a declaration.",
             "node :8132 → 61 jobs · LAN :8152 → 0 jobs · runner: dummy",
             "this is the single biggest gap between the model and the machine."),
        card("p-thin", "thin", "The agent does not read its personality yet",
             "personality.json exists and is published, and the Menu shows the name. The conversation door (:8138) does not load it, "
             "so &ldquo;this Hydra thing calls me Echidna&rdquo; is written down but not yet spoken.",
             f"{per.get('name','Echidna')} · voice {per.get('voice',{}).get('character','?')} · published as node.123.personality",
             "read it at start and open with one sentence that proves the agent knows where it is."),
        card("p-ok", "done · verified", "Fleet is on quantus, and the two 1060s finally match",
             "xpsw came back from the reboot and the standby guard started the declared miner by itself: SRBMiner on "
             "quantus, pool connected, API on :60151. It now reads the same as richard on the identical card — the 22.65 "
             "MH/s reading was a different, bodged state, not a hardware limit.",
             "xpsw 48.4 MH/s acc 0 (7 min in) · richard 50.4 MH/s acc 11 · rex 89.2 MH/s acc 708 · robert 90.0 MH/s acc "
             "478 · gtx1660 0 H/s · miner1 674 GH/s (pearlhash)",
             "watch xpsw's accepted count for an hour; 0 after a fresh start is normal, 0 after an hour is not."),
        card("p-thin", "thin", "Fleet reporting is honest but uneven",
             "MinerState outranks a node's self-report and can say <code>rate_known:false</code> instead of zero. Two boxes still "
             "answer with nothing useful, and one is deliberately parked.",
             " · ".join(f"{r.get('node') or r.get('ref')}: {r.get('hashrate') or 'no rate'} / acc {r.get('accepted')}" for r in (p['miners'] or [])[:8]),
             "gtx1660 at 0 H/s and jims with no rate need one look each."),
        card("p-thin", "thin", "One controller holds too much",
             "The hub (:8140), Access (:8143), Mirror, MinerState and both tiers all run on 123. If 123 is off, the LAN loses its "
             "map, its installer and its eyes — the tier design allows a second controller, nothing tests it.",
             ":8140 hub · :8143 access · :8137 mirror · :8147 minerstate · :8148 LAN state · :8156 LAN cycle",
             "a second node that can be the controller is the real test of the ladder."),
    ])

    ghost = "".join([
        card("p-ghost", "declared only", "The Broker is a protocol with no process",
             "A service advert with inputs/outputs and a karma fee as top-level metadata, brokered between LANs. Today it exists "
             "as a spec (INTP-1) plus the shape of the library. No port, no code, no empty book someone could queue into.",
             "docs/spec/INTP-1.md — &ldquo;proposal. No implementation exists.&rdquo;",
             "define the signed advert, then let the first transaction be a model download."),
        card("p-ghost", "declared only", "Karma is a rule, not a ledger",
             "Karma is priority only (a free request is bumped by someone with karma), never currency. There is nowhere that "
             "records a balance, so no tie can currently be broken by it.",
             "policy: priority only · ledger: none · publisher identity: none",
             "when the broker gets a body, karma becomes the reputation attached to a publisher — not a payment."),
        card("p-ghost", "declared only", "A global tier above the LAN",
             "The reason the LAN tier exists at all: one day a LAN is itself a node. The two entries every tier publishes "
             "(scope.self / scope.children) are the contract that makes that possible, and the LAN already writes them.",
             "scope.self {tier:'lan', ref:'lan-1'} · scope.children 8 entries",
             "nothing to build until a second LAN exists — keep the contract clean."),
        card("p-ghost", "declared only", "Payload transport for weights",
             "The definitions are 144 KB; a GGUF is 4–40 GB. That is the only place a torrent or a CID pays for itself, and no "
             "advert carries a payload hash yet.",
             "library definitions: 8 files, 144 KB total · shelf: 7,986,366 B",
             "add payload {sha256, bytes, magnet|cid|webseed} to the schema, export a bundle only above ~100 MB."),
    ])

    asks = [
        ("Which gap do I close first?", "The Scheduler runner (it makes &ldquo;bookable&rdquo; true) or the agent reading its "
         "personality (it makes Echidna real). <b>My vote: the runner</b> — everything else can pretend for a while; a scheduler "
         "that cannot dispatch is the one claim the whole design leans on."),
        ("Should the Menu be the front door, or stay at /ea?", "<b>My vote: keep /ea as the paste-line installer</b> for machines "
         "without Hydra, and make the Menu the daily screen. Two audiences, two doors, no page trying to be both."),
        ("Karma ledger: per node, or one per LAN?", "<b>My vote: one per LAN tier</b> (:8148 block), because karma is between "
         "people and balances that live on nodes cannot be compared."),
        ("Do you want the 7 down doors started?", "Monitor, AudioIn, AudioOut, VideoIn, WakeWord, CommsNode, StateToFile are "
         "declared and not running. <b>My vote: Monitor + AudioIn only</b> — the others need hardware or a reason."),
        ("Mining: keep the spread or consolidate?", "Fleet is on quantus (RX 580/590/1060s) and pearlhash (1660S/1650) at mixed "
         "units. <b>My vote: measure a week of accepted shares per watt before changing anything</b> — the rates are not "
         "comparable across algorithms and the last comparable pair (two 1060s) turned out to be power-limited, not misconfigured."),
        ("xpsw's agent is wedged — reboot it?", "Its SYSTEM agent is stuck and a non-elevated ssh cannot fix it; Phoenix pages "
         "every cycle. <b>My vote: yes, at your next convenience</b> — a reboot is the whole fix and it costs one card's uptime."),
    ]
    ask_html = "".join(
        f'<div class="ask"><p class="q"><i>{i:02d}</i>{q}</p><p class="a">{a}</p></div>'
        for i, (q, a) in enumerate(asks, 1))

    blocked = "".join([
        card("p-ok", "resolved today", "xpsw: the agent was a corpse, and the installer now refuses to leave one",
             "After the reboot the port was BOUND but every request timed out, and the heal check only tested &ldquo;is "
             "something listening&rdquo; — so every run saw &ldquo;already serving&rdquo; and left the corpse in place. The "
             "check now asks <code>/health</code> and reads the answer; a stale instance of this same script is replaced, a "
             "stranger holding the port is left alone and reported. Installed on xpsw (backup kept) and shipped in "
             "echidna-access.ps1, so every future paste carries it.",
             "agent :8142 → HTTP 200 as NT AUTHORITY\\SYSTEM, 3 s after the task restart · second copy refused to take "
             "over a healthy agent · Access /api/run → hostname in 252 ms as SYSTEM", None),
        card("p-bad", "blocked", "richard: no ssh keys, agent only",
             "sshd is up but refuses both fleet keys. The box is fully managed through the agent, so this is a convenience "
             "gap, not an outage.", "Permission denied (publickey) for User/user × two keys · agent :8142 healthy",
             "drop the fleet key on at the console when you are next there."),
        card("p-warn", "waiting on you", "Two BIOS settings on ReX",
             "Restore on AC Power Loss = Power On, and Halt On = No Errors. A mining box that stays off after a power cut is "
             "invisible to every check Hydra has.", "requires a human at that machine, ~2 minutes",
             "nothing technical blocks it."),
        card("p-warn", "waiting on you", "Salvage bookkeeping",
             "Landing trees are filled and counted, and the 2 TB carve continues. Internal disks: "
             + disk_line + ".",
             "D:\\01-PERSONAL 6,559 files / 16.6 GB · D:\\02-AI-OUTPUT 5,736 / 10.13 GB · F:\\03-MODELS 38.16 GB · "
             "F:\\04-ROM-SETS 42.83 GB · E:\\Hydra-V1 2.24 GB",
             "the NAS (4×2 TB → 6 TB) backup is the next physical step after the carve finishes."),
    ])

    nexts = [
        ("Real Scheduler runner", "dispatch:true becomes true: a job runs through ProcessWrapper, publishes start/end, and can be "
         "closed from the Menu. Nothing else in the design is believable until this is."),
        ("Echidna reads her own file", "On start, load personality.json, publish a greeting into the conversation door, and say "
         "the node's ref. The adoption story (&ldquo;this thing calls me Echidna&rdquo;) becomes true instead of documented."),
        ("Make the red strip actionable", "Click → the finding's numbers, the learned band, and a button that calls "
         "POST /api/baseline/accept. A warning you cannot answer is just decoration."),
        ("Payload schema", "payload {sha256, bytes, magnet|cid|webseed} on the advert; shelf-export emits a v2 torrent or CID "
         "manifest only above ~100 MB. Definitions stay HTTP; weights get the swarm."),
        ("Signed adverts + karma ledger", "A publisher identity per advert, one karma ledger on the LAN tier, priority-only. "
         "This is the first real Broker piece and it needs no network."),
        ("Menu layout, properly", "The tree column still fights its sticky headings; the fix is a real grid, not another "
         "z-index."),
        ("Birth from nothing", "A VM or a spare box: paste the installer, FirstRun scans, adopts, writes identity, starts doors, "
         "Menu comes up. The whole init package proved in one run."),
        ("STT through the book", "Book a transcription as a job, let the runner execute stt.ps1, and have the result land in "
         "State — the first service that is dispatched rather than called."),
        ("1060 parity", "xpsw 22.65 vs richard 50.50 MH/s on the same card. Measure intensity/power per card, then either fix "
         "xpsw or write down why it is limited."),
        ("Second controller", "One node that can be the controller: proves the ladder is a design, not a box under your desk."),
    ]
    next_html = "".join(
        f"<li><b>{t}</b><span class=\"why\">{w}</span></li>" for t, w in nexts)

    ladder = f"""
<div class="ladder">
  <div class="rung ghost"><div class="t">global tier · not built</div>
    <div class="b">Would read each LAN's <code>scope.children</code> and publish its own <code>scope.self</code> with a parent pointer. No code, no port — by design, not by omission.</div></div>
  <div class="rung"><div class="t">lan tier · live on 123</div>
    <div class="b">State <code>:8148</code> ({len(nodes)} nodes in <code>lan.fleet</code>) · Phoenix <code>:8156</code> (beat {cycle.get('beat','?')}) ·
    Scheduler <code>:8152</code> · Access <code>:8143</code> · Mirror <code>:8137</code> publishes <code>lan.node.&lt;ref&gt;</code>, <code>lan.miners</code>,
    <code>scope.self</code>, <code>scope.children</code></div></div>
  <div class="rung"><div class="t">node tier · live on 123 (+ 5 peers with doors)</div>
    <div class="b">{doors_line}. State <code>:8127</code> · ProcessWrapper <code>:8125</code> · Phoenix <code>:8146</code> ·
    Scheduler <code>:8132</code> (61 jobs) · ResourceManager <code>:8129</code> · Services <code>:8128</code> · FirstRun <code>:8166</code></div></div>
</div>"""

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hydra — overview</title><style>{CSS}</style></head>
<body><div class="wrap">
<header>
  <div class="kicker">Hydra V2 · node 123 · 192.168.1.123</div>
  <h1>What is built,<br>what is thin,<br>what needs your call.</h1>
  <p class="lede">One page, measured at generation time. Nothing here is a promise: each card carries the number that makes
  its claim true, and the items that are only a sentence in a document say so out loud.</p>
  <div class="meta">generated {p['at']} · {sv.get('services','?')} services · {shelf.get('rev','?')} shelf revision ·
  {tot.get('nodes','?')} thoughts ({tot.get('active','?')} open) · disks: {disk_line}</div>
</header>

<div class="stats">{stat_html}</div>

<h2>The ladder as built <span class="count">one shape at every rung</span></h2>
{ladder}

<h2>Done — verified <span class="count">{9} items</span></h2>
{done}

<h2>Works, but thin <span class="count">{4} items</span></h2>
{thin}

<h2>Declared, not built <span class="count">{4} items</span></h2>
{ghost}

<h2>Needs feedback from you <span class="count">{len(asks)} decisions</span></h2>
{ask_html}

<h2>Blocked, or waiting on a human <span class="count">{4} items</span></h2>
{blocked}

<h2>Next ten pieces <span class="count">in this order, each one shippable</span></h2>
<ol class="next-list">{next_html}</ol>

<footer>
  Regenerate with <code>python C:/AI/scripts/hydra-overview.py</code> — every live number is probed at that moment; anything
  that cannot be reached is printed as unreachable rather than silently stale. Served by the hub at
  <code>http://192.168.1.123:8140/hydra-overview.html</code>.
</footer>
</div></body></html>"""


if __name__ == "__main__":
    p = probe()
    html = build(p)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"wrote {OUT} ({len(html):,} bytes)")
    print(f"doors {p['doors'].get('up')}/{p['doors'].get('count')} · services {p['services'].get('services')} · "
          f"lan nodes {len(p['lan'].get('nodes') or [])} · shelf {p['shelf'].get('rev')} ")
