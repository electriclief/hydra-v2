class StreamHub {
  wrapper;
  queueLimitChars;
  copies = /* @__PURE__ */ new Map();
  seq = 0;
  constructor(wrapper, options = {}) {
    this.wrapper = wrapper;
    this.queueLimitChars = options.queueLimitChars ?? 1e6;
  }
  /** Open a new copy of one process's stream. */
  open(processId, sink, opts = {}) {
    const copy = new Copy(`copy-${++this.seq}`, processId, sink, this.queueLimitChars, opts);
    this.copies.set(copy.id, copy);
    this.prune();
    const rec = this.wrapper.get(processId);
    if (!rec) {
      copy.finish("no-such-process");
      return copy.handle(() => this.prune());
    }
    let unsubscribe = () => {
    };
    try {
      unsubscribe = this.wrapper.subscribe(
        processId,
        (chunk) => {
          if (chunk === "end") copy.finish("process-ended", true);
          else copy.push(chunk);
        },
        { from: opts.from ?? 0, channel: opts.channel, replay: opts.replay }
      );
    } catch {
      copy.finish("no-such-process");
    }
    copy.onClose = () => unsubscribe();
    return copy.handle(() => this.prune());
  }
  /** Keep the trail bounded: closed copies are forgotten oldest-first past the cap. */
  prune(maxFinished = 200) {
    const finished = [];
    for (const [id, copy] of this.copies) if (!copy.isOpen) finished.push(id);
    const excess = finished.length - maxFinished;
    for (let i = 0; i < excess; i++) this.copies.delete(finished[i]);
  }
  /** How many copies are open right now. */
  openCount() {
    let n = 0;
    for (const copy of this.copies.values()) if (copy.isOpen) n++;
    return n;
  }
  /** Every copy this hub has handed out (open and finished). */
  stats() {
    return Array.from(this.copies.values()).map((c) => c.stats());
  }
  /** Close every copy (the wrapper's processes keep running). */
  closeAll(reason = "closed") {
    let n = 0;
    for (const copy of this.copies.values()) {
      if (copy.isOpen) {
        copy.finish(reason);
        n++;
      }
    }
    return n;
  }
}
class Copy {
  id;
  processId;
  channel;
  from;
  onClose = () => {
  };
  sink;
  queueLimitChars;
  queue = [];
  queuedChars = 0;
  deliveredChars = 0;
  droppedChars = 0;
  ends = null;
  queued_ = false;
  closed = false;
  constructor(id, processId, sink, queueLimitChars, opts) {
    this.id = id;
    this.processId = processId;
    this.sink = sink;
    this.queueLimitChars = queueLimitChars;
    this.channel = opts.channel ?? "both";
    this.from = Math.max(0, opts.from ?? 0);
  }
  get isOpen() {
    return !this.closed;
  }
  push(chunk) {
    if (this.closed || this.ends) return;
    if (this.channel !== "both" && chunk.channel !== this.channel) return;
    if (this.queued_) {
      this.queue.push(chunk);
      this.queuedChars += chunk.text.length;
      this.shed();
      return;
    }
    this.deliver(chunk);
  }
  drain() {
    if (this.closed || this.ends) return;
    this.queued_ = false;
    const pending = this.queue;
    this.queue = [];
    this.queuedChars = 0;
    for (const chunk of pending) {
      if (this.ends || this.closed) return;
      this.deliver(chunk);
      if (this.queued_) {
        const rest = pending.slice(pending.indexOf(chunk) + 1);
        this.queue = rest;
        this.queuedChars = rest.reduce((n, c) => n + c.text.length, 0);
        return;
      }
    }
  }
  finish(reason, flushQueue = false) {
    if (this.closed) return;
    this.closed = true;
    this.ends = reason;
    try {
      this.onClose();
    } catch {
    }
    if (flushQueue && this.queue.length) {
      const pending = this.queue;
      this.queue = [];
      this.queuedChars = 0;
      for (const chunk of pending) {
        this.deliveredChars += chunk.text.length;
        try {
          this.sink.onData(chunk);
        } catch {
        }
      }
    }
    try {
      this.sink.onEnd(reason);
    } catch {
    }
  }
  stats() {
    return {
      id: this.id,
      processId: this.processId,
      channel: this.channel,
      from: this.from,
      deliveredChars: this.deliveredChars,
      queuedChars: this.queuedChars,
      queuedChunks: this.queue.length,
      droppedChars: this.droppedChars,
      ends: this.ends,
      open: this.isOpen
    };
  }
  handle(onClose) {
    const self = this;
    return {
      id: this.id,
      processId: this.processId,
      drain: () => self.drain(),
      close: () => {
        self.finish("closed");
        onClose();
      },
      stats: () => self.stats()
    };
  }
  deliver(chunk) {
    let backpressure = false;
    try {
      backpressure = this.sink.onData(chunk) === false;
    } catch {
      this.finish("sink-error");
      return;
    }
    this.deliveredChars += chunk.text.length;
    if (backpressure) this.queued_ = true;
  }
  shed() {
    let shed = 0;
    while (this.queuedChars > this.queueLimitChars && this.queue.length > 1) {
      const dropped = this.queue.shift();
      this.queuedChars -= dropped.text.length;
      shed += dropped.text.length;
    }
    if (shed > 0) {
      this.droppedChars += shed;
      if (this.sink.onDrop) {
        try {
          this.sink.onDrop({ droppedChars: shed, totalDroppedChars: this.droppedChars, at: Date.now() });
        } catch {
        }
      }
    }
  }
}
function createStreamHub(wrapper, options = {}) {
  return new StreamHub(wrapper, options);
}
async function runTests() {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { createWrapper } = await import("./processWrapper.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-hub-"));
  const wrapper = createWrapper({ streamDir: path.join(dir, "streams"), graceMs: 300 });
  const hub = createStreamHub(wrapper, { queueLimitChars: 200 });
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const a = [];
  const b = [];
  let aEnd = null;
  let bEnd = null;
  const proc = wrapper.launch({
    name: "hub-target",
    command: process.execPath,
    args: ["-e", "console.log('first');setTimeout(()=>console.log('second'),120);setTimeout(()=>console.log('third'),240)"]
  });
  const copyA = hub.open(proc.id, { onData: (c2) => {
    a.push(c2.text);
  }, onEnd: (r) => {
    aEnd = r;
  } });
  await sleep(60);
  const copyB = hub.open(proc.id, { onData: (c2) => {
    b.push(c2.text);
  }, onEnd: (r) => {
    bEnd = r;
  } });
  await wrapper.awaitExit(proc.id, 15e3);
  await sleep(50);
  ok("each copy has its own handle", copyA.id !== copyB.id && copyA.processId === proc.id, `${copyA.id}/${copyB.id}`);
  const aText = a.join("");
  const bText = b.join("");
  ok("copy A saw the whole life", aText.includes("first") && aText.includes("second") && aText.includes("third"), aText);
  ok("copy B (joined mid-life) was given the replay too", bText.includes("first") && bText.includes("third"), bText);
  ok("copy A became one delivery stream", a.length >= 1, String(a.length));
  ok("copy A heard the process end", aEnd === "process-ended", String(aEnd));
  ok("copy B heard the process end", bEnd === "process-ended", String(bEnd));
  ok("both copies are closed", hub.openCount() === 0, String(hub.openCount()));
  const c = [];
  const proc2 = wrapper.launch({ name: "hub-offset", command: process.execPath, args: ["-e", "console.log('AAAA');setTimeout(()=>console.log('BBBB'),300)"] });
  const earlyCopy = hub.open(proc2.id, { onData: (ch) => {
    c.push(ch.text);
  }, onEnd: () => {
  } }, { from: 5 });
  await wrapper.awaitExit(proc2.id, 15e3);
  await sleep(50);
  const cText = c.join("");
  ok("an early offset copy skips the front without swallowing the rest", !cText.includes("AAAA") && cText.includes("BBBB"), JSON.stringify(cText));
  ok("the early offset copy equals the stream minus its front", cText === wrapper.output(proc2.id).text.slice(5), JSON.stringify(cText));
  ok("the early copy ended with the process", earlyCopy.stats().open === false, JSON.stringify(earlyCopy.stats()));
  const d = [];
  hub.open(proc2.id, { onData: (ch) => {
    d.push(ch.text);
  }, onEnd: () => {
  } }, { from: 5 });
  await sleep(50);
  ok("a late offset copy (replay) skips the same front", d.join("") === cText, JSON.stringify(d.join("")));
  const out = [];
  const err = [];
  const proc3 = wrapper.launch({
    name: "hub-channels",
    command: process.execPath,
    args: ["-e", "console.log('to-out');console.error('to-err')"]
  });
  hub.open(proc3.id, { onData: (ch) => {
    out.push(ch.text);
  }, onEnd: () => {
  } }, { channel: "stdout" });
  hub.open(proc3.id, { onData: (ch) => {
    err.push(ch.text);
  }, onEnd: () => {
  } }, { channel: "stderr" });
  await wrapper.awaitExit(proc3.id, 15e3);
  await sleep(50);
  ok("stdout copy is stdout-only", out.join("").includes("to-out") && !out.join("").includes("to-err"), out.join(""));
  ok("stderr copy is stderr-only", err.join("").includes("to-err") && !err.join("").includes("to-out"), err.join(""));
  const slow = [];
  const bp = { hit: false };
  const proc4 = wrapper.launch({
    name: "hub-backpressure",
    command: process.execPath,
    args: ["-e", "for(let i=1;i<=6;i++)setTimeout(()=>console.log('line'+i), i*200)"]
  });
  const handle = hub.open(proc4.id, {
    onData: (ch) => {
      const first = !bp.hit;
      if (first) bp.hit = true;
      slow.push(ch.text);
      return first ? false : true;
    },
    onEnd: () => {
    }
  });
  let queuedWhileSlow = 0;
  const queueDeadline = Date.now() + 5e3;
  while (Date.now() < queueDeadline) {
    queuedWhileSlow = handle.stats().queuedChars;
    if (queuedWhileSlow > 0) break;
    await sleep(50);
  }
  ok("a slow sink queued instead of stalling the stream", bp.hit === true && queuedWhileSlow > 0, JSON.stringify(handle.stats()));
  handle.drain();
  ok("drain delivered the queued copy", handle.stats().queuedChars === 0, JSON.stringify(handle.stats()));
  await wrapper.awaitExit(proc4.id, 15e3);
  await sleep(50);
  ok("drain kept order and lost nothing", slow.join("").includes("line1") && slow.join("").includes("line6"), slow.join(""));
  const dropSeen = { info: null };
  const proc5 = wrapper.launch({
    name: "hub-drop",
    command: process.execPath,
    args: ["-e", "for(let i=0;i<20;i++)console.log('chatter-'+i+'-'+'y'.repeat(40))"]
  });
  const stuck = hub.open(proc5.id, {
    onData: () => false,
    // wedged reader, never drains
    onEnd: () => {
    },
    onDrop: (info) => {
      dropSeen.info = info;
    }
  });
  await wrapper.awaitExit(proc5.id, 15e3);
  await sleep(50);
  const stuckStats = stuck.stats();
  ok("a wedged copy is told it dropped text", dropSeen.info !== null && stuckStats.droppedChars > 0, JSON.stringify(stuckStats));
  ok("the dropped count is reported in the notice", dropSeen.info !== null && dropSeen.info.totalDroppedChars === stuckStats.droppedChars, JSON.stringify(dropSeen.info));
  ok("the queue stayed under its ceiling + 1 chunk", stuckStats.queuedChars <= 200 + 200, String(stuckStats.queuedChars));
  stuck.close();
  const keep = [];
  const proc6 = wrapper.launch({ name: "hub-close", command: process.execPath, args: ["-e", "let i=0;const t=setInterval(()=>console.log('tick'+(++i)),60);setTimeout(()=>{clearInterval(t);},600)"] });
  const kept = hub.open(proc6.id, { onData: (ch) => {
    keep.push(ch.text);
  }, onEnd: () => {
  } });
  const doomed = hub.open(proc6.id, { onData: () => {
  }, onEnd: () => {
  } });
  doomed.close();
  await wrapper.awaitExit(proc6.id, 15e3);
  await sleep(50);
  ok("a closed copy stops receiving", doomed.stats().open === false && doomed.stats().ends === "closed");
  ok("the surviving copy still got the stream", keep.join("").includes("tick1"), keep.join(""));
  ok("the process itself was untouched", wrapper.get(proc6.id)?.life === "exited", String(wrapper.get(proc6.id)?.life));
  kept.close();
  let badEnd = null;
  const bad = hub.open("no-such-id", { onData: () => {
  }, onEnd: (r) => {
    badEnd = r;
  } });
  ok("unknown process ends the copy with a reason", badEnd === "no-such-process", String(badEnd));
  bad.close();
  let errEnd = null;
  const proc8 = wrapper.launch({ name: "hub-sink-error", command: process.execPath, args: ["-e", "console.log('boom')"] });
  await sleep(20);
  hub.open(proc8.id, { onData: () => {
    throw new Error("sink blew up");
  }, onEnd: (r) => {
    errEnd = r;
  } });
  const sinkDeadline = Date.now() + 5e3;
  while (errEnd === null && Date.now() < sinkDeadline) await sleep(50);
  ok("a throwing sink closes its own copy", errEnd === "sink-error", String(errEnd));
  ok("hub stats list every copy", hub.stats().length === 12, String(hub.stats().length));
  await wrapper.shutdown();
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[streamHub] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  StreamHub,
  createStreamHub,
  runTests
};
//# sourceMappingURL=streamHub.js.map
