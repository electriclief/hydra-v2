import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const ROOT_FILE = "root.log";
function append(file, chunk) {
  try {
    fs.appendFileSync(file, chunk, "utf8");
    return Buffer.byteLength(chunk, "utf8");
  } catch {
    return 0;
  }
}
function captureRootLife(options) {
  const name = options.name ?? "process-wrapper (root)";
  const pid = options.pid ?? process.pid;
  const now = options.now ?? (() => /* @__PURE__ */ new Date());
  const startedAt = now().toISOString();
  fs.mkdirSync(options.streamDir, { recursive: true });
  const streamFile = path.join(options.streamDir, ROOT_FILE);
  append(streamFile, `--- root life \xB7 ${name} \xB7 pid ${pid} \xB7 ${startedAt} ---
`);
  const state = { bytes: 0, closed: false };
  const tee = (stream) => {
    const original = stream.write.bind(stream);
    return (...args) => {
      if (!state.closed) {
        const text = typeof args[0] === "string" ? args[0] : String(args[0] ?? "");
        state.bytes += append(streamFile, text);
      }
      return original(...args);
    };
  };
  process.stdout.write = tee(process.stdout);
  process.stderr.write = tee(process.stderr);
  const record = {
    id: "root",
    name,
    pid,
    life: "running",
    startedAt,
    streamFile,
    get bytes() {
      return state.bytes;
    }
  };
  return {
    record,
    close() {
      state.closed = true;
      append(streamFile, `--- root life closed \xB7 ${now().toISOString()} ---
`);
    }
  };
}
async function runTests() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-rootlife-"));
  try {
    const born = /* @__PURE__ */ new Date("2026-10-05T12:00:00.000Z");
    const life = captureRootLife({ streamDir: dir, pid: 4242, now: () => born });
    console.assert(life.record.id === "root", "the root reports itself as the root", life.record.id);
    console.assert(life.record.pid === 4242, "it reports its own pid", String(life.record.pid));
    console.assert(life.record.life === "running", "the root is alive while it answers");
    console.assert(fs.existsSync(life.record.streamFile), "its life file exists on disk", life.record.streamFile);
    const header = fs.readFileSync(life.record.streamFile, "utf8");
    console.assert(header.includes("root life"), "the file describes itself", header.slice(0, 40));
    console.assert(header.includes("4242"), "the pid is in the record", header.slice(0, 60));
    let seen = "";
    const spy = process.stdout.write;
    process.stdout.write("root output line A\n");
    seen = fs.readFileSync(life.record.streamFile, "utf8");
    console.assert(seen.includes("root output line A"), "stdout is captured to the life file", seen.slice(-40));
    console.assert(typeof spy === "function", "the stream is left callable");
    process.stderr.write("root error line B\n");
    seen = fs.readFileSync(life.record.streamFile, "utf8");
    console.assert(seen.includes("root error line B"), "stderr is captured too", seen.slice(-40));
    console.assert(life.record.bytes > 0, "the byte count moves", String(life.record.bytes));
    life.close();
    const afterClose = fs.readFileSync(life.record.streamFile, "utf8");
    console.assert(afterClose.includes("closed"), "closing writes its own closing line", afterClose.slice(-40));
    const before = life.record.bytes;
    process.stdout.write("this must not be captured\n");
    console.assert(life.record.bytes === before, "a closed root stops capturing (the file is final)");
  } catch (e) {
    console.assert(false, "the rootLife suite ran without a crash", e instanceof Error ? e.message : String(e));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
export {
  captureRootLife,
  runTests
};
//# sourceMappingURL=rootLife.js.map
