function normalizePath(input) {
  let p = String(input ?? "").trim().replace(/\\/g, "/");
  p = p.replace(/\/+/g, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p.toLowerCase();
}
function pathsCollide(a, b) {
  const na = normalizePath(a);
  const nb = normalizePath(b);
  if (!na || !nb) return false;
  return na === nb || na.startsWith(nb + "/") || nb.startsWith(na + "/");
}
function asTrimmedString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function asAmount(value) {
  if (value === void 0 || value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}
function validateBookRequest(raw) {
  if (!raw || typeof raw !== "object") return { ok: false, message: "the book request must be a JSON object" };
  const body = raw;
  const service = asTrimmedString(body.service);
  if (!service) return { ok: false, message: "service is required \u2014 a booking always sources from a request to run a service" };
  const request = { service };
  request.mode = asTrimmedString(body.mode);
  request.gpu = asTrimmedString(body.gpu);
  request.expected = asTrimmedString(body.expected);
  request.note = asTrimmedString(body.note);
  request.run = asTrimmedString(body.run);
  for (const key of ["cores", "ramMb", "diskMb"]) {
    const amount = asAmount(body[key]);
    if (amount !== null && (amount < 0 || !Number.isFinite(amount))) {
      return { ok: false, message: `${key} must be a number \u2265 0` };
    }
    request[key] = amount;
  }
  if (body.paths !== void 0 && body.paths !== null) {
    if (!Array.isArray(body.paths)) return { ok: false, message: "paths must be an array of absolute paths" };
    const paths = [];
    for (const item of body.paths) {
      const path = asTrimmedString(item);
      if (!path) return { ok: false, message: "every path must be a non-empty string" };
      paths.push(path);
    }
    request.paths = paths;
  } else {
    request.paths = [];
  }
  const hasAnyResource = request.gpu !== null || (request.cores ?? 0) > 0 || (request.ramMb ?? 0) > 0 || (request.diskMb ?? 0) > 0 || (request.paths?.length ?? 0) > 0;
  if (!hasAnyResource) return { ok: false, message: "nothing to book \u2014 name a gpu, an amount of cores/ramMb/diskMb, or paths" };
  return { ok: true, request };
}
function totalsOf(readings) {
  let diskFreeMb = 0;
  for (const disk of readings.disks ?? []) diskFreeMb += Number.isFinite(disk.freeMb) ? disk.freeMb : 0;
  return {
    cores: Number.isFinite(readings.cpu?.cores) ? readings.cpu.cores : 0,
    ramMb: Number.isFinite(readings.ram?.totalMb) ? readings.ram.totalMb : 0,
    diskFreeMb
  };
}
function summarizeBooking(booking) {
  const bits = [];
  if (booking.gpu) bits.push(`gpu ${booking.gpu}`);
  if (booking.cores) bits.push(`${booking.cores} cores`);
  if (booking.ramMb) bits.push(`${booking.ramMb} MB ram`);
  if (booking.diskMb) bits.push(`${booking.diskMb} MB disk`);
  if (booking.paths.length) bits.push(booking.paths.join(" \xB7 "));
  return bits.join(" \xB7 ");
}
async function runTests() {
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  ok("normalize: slashes and case fold", normalizePath("C:\\Work\\Proj\\") === "c:/work/proj");
  ok("normalize: trailing separators drop", normalizePath("C:/work/proj//") === "c:/work/proj");
  ok("collide: equal paths", pathsCollide("C:\\work\\proj", "c:/WORK/proj"));
  ok("collide: child is covered (children assumed)", pathsCollide("C:/work/proj", "C:/work/proj/src/main.ts"));
  ok("collide: ancestor direction also", pathsCollide("C:/work/proj/src", "C:/work/proj"));
  ok("collide: siblings do not collide", !pathsCollide("C:/work/proj", "C:/work/proj2"));
  ok("collide: unrelated do not collide", !pathsCollide("C:/a", "D:/b"));
  ok("collide: prefix-but-not-child does not collide", !pathsCollide("C:/work/pro", "C:/work/proj"));
  const good = validateBookRequest({ service: "image-gen", mode: "krea2", gpu: "AMD Radeon RX 6800", cores: 4, ramMb: 8e3, paths: ["C:\\work\\out"] });
  ok("validate: a full request passes", good.ok === true && good.ok && good.request.service === "image-gen" && good.request.paths?.length === 1);
  const noService = validateBookRequest({ cores: 2 });
  ok("validate: service is required", noService.ok === false && !noService.ok && noService.message.includes("service"));
  const negative = validateBookRequest({ service: "x", cores: -1 });
  ok("validate: negative amounts refused", negative.ok === false);
  const nothing = validateBookRequest({ service: "x" });
  ok("validate: nothing to book refused", nothing.ok === false && !nothing.ok && nothing.message.includes("nothing to book"));
  const badPaths = validateBookRequest({ service: "x", paths: "C:/one" });
  ok("validate: paths must be an array", badPaths.ok === false);
  const totals = totalsOf({
    collectedAt: "",
    node: "",
    platform: "",
    cpu: { model: "x", cores: 16, loadPct: 10 },
    ram: { totalMb: 32e3, freeMb: 2e4 },
    gpus: [],
    gpusObserved: [],
    notes: [],
    disks: [{ device: "C:", freeMb: 1e3, totalMb: 2e3 }, { device: "D:", freeMb: 500, totalMb: 9e3 }],
    shares: []
  });
  ok("totals: cores \xB7 ram \xB7 disk free sum", totals.cores === 16 && totals.ramMb === 32e3 && totals.diskFreeMb === 1500);
  const summary = summarizeBooking({
    id: "bk-1",
    service: "demo",
    mode: null,
    gpu: "RX 6800",
    cores: 4,
    ramMb: 8e3,
    diskMb: null,
    paths: ["C:/work"],
    expected: null,
    note: null,
    run: null,
    bookedAt: ""
  });
  ok("summarize: names what is held", summary.includes("RX 6800") && summary.includes("4 cores") && summary.includes("C:/work"));
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[resourceSchema] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  normalizePath,
  pathsCollide,
  runTests,
  summarizeBooking,
  totalsOf,
  validateBookRequest
};
//# sourceMappingURL=resourceSchema.js.map
