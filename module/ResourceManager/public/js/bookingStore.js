import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathsCollide, totalsOf, validateBookRequest } from "./resourceSchema.js";
import { collectReads } from "./resourceRead.js";
const ENDED_CAP = 100;
function safeReads(fn) {
  return Promise.resolve().then(fn).catch(() => null);
}
function createBookingStore(options = {}) {
  const dataFile = options.file ?? path.join(options.dataDir ?? "./data", "bookings.json");
  const readsFn = options.reads ?? (() => collectReads(options.collect ?? {}));
  let activeBookings = [];
  let endedBookings = [];
  function load() {
    try {
      if (!fs.existsSync(dataFile)) return;
      const parsed = JSON.parse(fs.readFileSync(dataFile, "utf8"));
      activeBookings = Array.isArray(parsed.active) ? parsed.active : [];
      endedBookings = Array.isArray(parsed.ended) ? parsed.ended : [];
    } catch {
      activeBookings = [];
      endedBookings = [];
    }
  }
  function save() {
    try {
      fs.mkdirSync(path.dirname(dataFile), { recursive: true });
      const payload = { version: 1, active: activeBookings, ended: endedBookings };
      fs.writeFileSync(dataFile, JSON.stringify(payload, null, 2));
    } catch {
    }
  }
  load();
  const sumWhere = (pick) => activeBookings.reduce((total, booking) => total + (pick(booking) ?? 0), 0);
  async function book(raw) {
    const validated = validateBookRequest(raw);
    if (!validated.ok) {
      return { ok: false, error: { code: "invalid_book", message: validated.message, blockers: [] } };
    }
    const request = validated.request;
    const readings = await safeReads(readsFn);
    const blockers = [];
    const heldBy = (booking2) => ({ id: booking2.id, service: booking2.service, since: booking2.bookedAt });
    if (request.gpu) {
      const conflicting = activeBookings.find((booking2) => booking2.gpu && booking2.gpu.toLowerCase() === request.gpu.toLowerCase());
      if (conflicting) {
        blockers.push({ kind: "gpu", detail: `gpu ${request.gpu} is booked by ${conflicting.service} (since ${conflicting.bookedAt})`, heldBy: heldBy(conflicting) });
      } else if (readings && readings.gpus.length > 0 && !readings.gpus.some((gpu) => gpu.name.toLowerCase() === request.gpu.toLowerCase())) {
        blockers.push({ kind: "gpu", detail: `this node does not have that gpu: ${request.gpu}`, heldBy: null });
      }
    }
    if ((request.cores ?? 0) > 0 && readings) {
      const total = readings.cpu.cores;
      const already = sumWhere((booking2) => booking2.cores);
      if (already + (request.cores ?? 0) > total) {
        blockers.push({ kind: "cores", detail: `cores: ${already} of ${total} booked \u2014 ${already + (request.cores ?? 0)} requested`, heldBy: null });
      }
    }
    if ((request.ramMb ?? 0) > 0 && readings) {
      const total = readings.ram.totalMb;
      const already = sumWhere((booking2) => booking2.ramMb);
      if (already + (request.ramMb ?? 0) > total) {
        blockers.push({ kind: "ram", detail: `ram: ${already} of ${total} MB booked \u2014 ${already + (request.ramMb ?? 0)} MB requested`, heldBy: null });
      }
    }
    if ((request.diskMb ?? 0) > 0 && readings && readings.disks.length > 0) {
      const totals = totalsOf(readings);
      const already = sumWhere((booking2) => booking2.diskMb);
      if (already + (request.diskMb ?? 0) > totals.diskFreeMb) {
        blockers.push({ kind: "disk", detail: `disk: ${already} of ${totals.diskFreeMb} MB free booked \u2014 ${already + (request.diskMb ?? 0)} MB requested`, heldBy: null });
      }
    }
    for (const wanted of request.paths ?? []) {
      for (const booking2 of activeBookings) {
        const clash = booking2.paths.find((held) => pathsCollide(wanted, held));
        if (clash) {
          blockers.push({ kind: "path", detail: `${wanted} overlaps ${clash} held by ${booking2.service}`, heldBy: heldBy(booking2) });
        }
      }
    }
    if (blockers.length > 0) {
      return {
        ok: false,
        error: {
          code: blockers.some((blocker) => blocker.heldBy !== null) ? "double_booked" : "missing_resource",
          message: blockers.map((blocker) => blocker.detail).join("; "),
          blockers
        }
      };
    }
    const booking = {
      id: "bk-" + randomUUID().replace(/-/g, "").slice(0, 12),
      service: request.service,
      mode: request.mode ?? null,
      gpu: request.gpu ?? null,
      cores: request.cores ?? null,
      ramMb: request.ramMb ?? null,
      diskMb: request.diskMb ?? null,
      paths: request.paths ?? [],
      expected: request.expected ?? null,
      note: request.note ?? null,
      run: request.run ?? null,
      bookedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    activeBookings.push(booking);
    save();
    return { ok: true, booking };
  }
  function end(id, reason) {
    const index = activeBookings.findIndex((booking2) => booking2.id === id);
    if (index < 0) return null;
    const [booking] = activeBookings.splice(index, 1);
    const ended = { ...booking, endedAt: (/* @__PURE__ */ new Date()).toISOString(), endReason: reason };
    endedBookings.push(ended);
    if (endedBookings.length > ENDED_CAP) endedBookings = endedBookings.slice(-ENDED_CAP);
    save();
    return ended;
  }
  return {
    book,
    pop: (id) => end(id, "popped"),
    clear: (id) => end(id, "cleared"),
    get: (id) => activeBookings.find((booking) => booking.id === id) ?? endedBookings.find((booking) => booking.id === id) ?? null,
    active: () => [...activeBookings],
    ended: () => [...endedBookings],
    reload: load,
    save,
    dataFile
  };
}
async function runTests() {
  const fsMod = await import("node:fs");
  const os = await import("node:os");
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const dir = fsMod.mkdtempSync(path.join(os.tmpdir(), "rm-store-"));
  const fakeReads = {
    collectedAt: (/* @__PURE__ */ new Date()).toISOString(),
    node: "test-node",
    platform: "win32",
    cpu: { model: "fake", cores: 16, loadPct: 5 },
    ram: { totalMb: 32e3, freeMb: 2e4 },
    gpus: [{ name: "AMD Radeon RX 6800", vramMb: 16384, vramSource: "registry", memUsedMb: null }],
    gpusObserved: [],
    disks: [{ device: "C:", freeMb: 4e5, totalMb: 5e5 }],
    shares: [],
    notes: []
  };
  const store = createBookingStore({ dataDir: dir, reads: () => fakeReads });
  const first = await store.book({ service: "image-gen", gpu: "AMD Radeon RX 6800", cores: 4, ramMb: 1e3, diskMb: 500, paths: ["C:\\work\\proj"], expected: "~20 min" });
  ok("book: the whole book lands", first.ok === true && first.ok && first.booking.id.startsWith("bk-"), JSON.stringify(first).slice(0, 120));
  ok("book: it persists to disk", fsMod.existsSync(store.dataFile));
  const second = await store.book({ service: "other", gpu: "AMD Radeon RX 6800" });
  ok("book: a second app on the same gpu is refused (1 app per gpu)", second.ok === false && !second.ok && second.error.code === "double_booked");
  ok("book: the refusal names the holder (wait info)", second.ok === false && !second.ok && second.error.blockers[0].heldBy?.service === "image-gen");
  const child = await store.book({ service: "agent-b", paths: ["C:\\work\\proj\\src"] });
  ok("book: a child path collides (children assumed)", child.ok === false && !child.ok && child.error.blockers.some((b) => b.kind === "path"));
  const sibling = await store.book({ service: "agent-b", paths: ["C:\\work\\proj2"] });
  ok("book: a sibling path books fine", sibling.ok === true);
  const missingGpu = await store.book({ service: "x", gpu: "GTX 9990" });
  ok("book: a gpu this node does not have is refused as missing", missingGpu.ok === false && !missingGpu.ok && missingGpu.error.code === "missing_resource");
  const tooManyCores = await store.book({ service: "x", cores: 13 });
  ok("book: cores over the machine are refused", tooManyCores.ok === false && !tooManyCores.ok && tooManyCores.error.blockers.some((b) => b.kind === "cores"));
  const coresFit = await store.book({ service: "x", cores: 12 });
  ok("book: cores up to the machine book fine", coresFit.ok === true);
  const ramOver = await store.book({ service: "x", ramMb: 31100 });
  ok("book: ram over the machine is refused", ramOver.ok === false);
  const diskOver = await store.book({ service: "x", diskMb: 399900 });
  ok("book: disk over the free space is refused", diskOver.ok === false && !diskOver.ok && diskOver.error.blockers.some((b) => b.kind === "disk"));
  const invalid = await store.book({ cores: 2 });
  ok("book: no service = invalid", invalid.ok === false && !invalid.ok && invalid.error.code === "invalid_book");
  const negative = await store.book({ service: "x", cores: -2 });
  ok("book: negative amounts are invalid", negative.ok === false);
  ok("active: three bookings are held", store.active().length === 3, String(store.active().length));
  const held = store.active()[0];
  const popped = store.pop(held.id);
  ok("pop: the booking lifts", popped !== null && popped?.endReason === "popped" && store.get(held.id)?.hasOwnProperty("endedAt") === true);
  ok("pop: the freed gpu books again", (await store.book({ service: "second-run", gpu: "AMD Radeon RX 6800" })).ok === true);
  ok("pop: an unknown id answers null", store.pop("bk-nope") === null);
  const cleared = store.clear(store.active()[0].id);
  ok("clear: the manual exit works too", cleared !== null && cleared?.endReason === "cleared");
  const reloaded = createBookingStore({ dataDir: dir, reads: () => fakeReads });
  ok("reload: bookings survive a fresh store on the same folder", reloaded.active().length === store.active().length);
  const noReads = createBookingStore({ dataDir: dir, reads: () => Promise.reject(new Error("no reads")) });
  ok("book: a dead reader still allows register-only books", (await noReads.book({ service: "y", paths: ["D:\\elsewhere"] })).ok === true);
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[bookingStore] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  createBookingStore,
  runTests
};
//# sourceMappingURL=bookingStore.js.map
