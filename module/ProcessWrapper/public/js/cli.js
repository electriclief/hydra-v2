#!/usr/bin/env node
import process from "node:process";
import { createProcessClient } from "./client.js";
function parseCliArgs(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      args.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq > 0) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags[name] = next;
      i++;
    } else {
      flags[name] = true;
    }
  }
  return { command: args[0] ?? "help", args: args.slice(1), flags };
}
const HELP = [
  "ProcessWrapper CLI \u2014 the terminal face of a running wrapper.",
  "",
  "  pw health",
  '  pw start "<command>" [--name N] [--tag T] [--cwd DIR] [--shell] [--follow]',
  "  pw list [--life running|exited|killed|failed]",
  "  pw show <id>",
  "  pw output <id> [--from N] [--limit N] [--channel stdout|stderr]",
  "  pw follow <id> [--from N]",
  '  pw input <id> "<text>"',
  "  pw kill <id> [--force]",
  "  pw rm <id>",
  '  pw commands | pw save <name> "<command>" [--desc D] | pw unsave <name>',
  "",
  "Global: --url http://127.0.0.1:8125  --token <shared-secret>",
  "",
  "Quote anything with a space in it \u2014 the command is split on spaces, so a path must be",
  'quoted:  pw start "\\"C:\\Program Files\\nodejs\\node.exe\\" -e \\"console.log(1)\\""'
].join("\n");
async function runCli(argv, io = { out: console.log, err: console.error }, client) {
  const opts = parseCliArgs(argv);
  const url = typeof opts.flags.url === "string" ? opts.flags.url : "http://127.0.0.1:8125";
  const token = typeof opts.flags.token === "string" ? opts.flags.token : null;
  const api = client ?? createProcessClient({ baseUrl: url, token });
  const numFlag = (name) => {
    const raw = opts.flags[name];
    if (typeof raw !== "string") return void 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : void 0;
  };
  try {
    switch (opts.command) {
      case "help":
        io.out(HELP);
        return 0;
      case "health": {
        const h = await api.health();
        io.out(JSON.stringify(h, null, 2));
        return 0;
      }
      case "start": {
        const command = opts.args.join(" ").trim();
        if (!command) {
          io.err('pw start needs a command: pw start "python bar.py"  (quote any path with a space)');
          return 2;
        }
        const rec = await api.launch({
          command,
          name: typeof opts.flags.name === "string" ? opts.flags.name : void 0,
          tag: typeof opts.flags.tag === "string" ? opts.flags.tag : null,
          cwd: typeof opts.flags.cwd === "string" ? opts.flags.cwd : void 0,
          shell: opts.flags.shell === true
        });
        io.out(`${rec.id}  pid ${rec.pid}  ${rec.life}  ${rec.name}`);
        if (opts.flags.follow === true) {
          for await (const ev of api.stream(rec.id, { from: 0 })) {
            if (ev.event === "chunk") io.out(String(ev.data.text).replace(/\n$/, ""));
            if (ev.event === "drop") io.out(`[dropped ${ev.data.droppedChars} chars]`);
            if (ev.event === "end") break;
          }
          const after = await api.get(rec.id);
          io.out(`\u2014 ${after.process.life} (exit ${after.process.exitCode})`);
        }
        return 0;
      }
      case "list": {
        const life = typeof opts.flags.life === "string" ? opts.flags.life : void 0;
        const list = await api.list(life ? { life } : {});
        if (!list.length) {
          io.out("(no processes)");
          return 0;
        }
        for (const p of list) {
          io.out(`${p.id.padEnd(24)} ${String(p.pid ?? "-").padStart(7)}  ${p.life.padEnd(8)} ${p.name}`);
        }
        return 0;
      }
      case "show": {
        const id = opts.args[0];
        if (!id) {
          io.err("pw show needs an id");
          return 2;
        }
        const detail = await api.get(id);
        io.out(JSON.stringify(detail, null, 2));
        return 0;
      }
      case "output": {
        const id = opts.args[0];
        if (!id) {
          io.err("pw output needs an id");
          return 2;
        }
        const copy = await api.output(id, {
          from: numFlag("from"),
          limit: numFlag("limit"),
          channel: typeof opts.flags.channel === "string" ? opts.flags.channel : void 0
        });
        io.out(copy.text.replace(/\n$/, ""));
        io.err(`\u2014 ${copy.to - copy.from} of ${copy.total} chars${copy.complete ? "" : " (the buffer shed the front; the life file has it all)"}`);
        return 0;
      }
      case "follow": {
        const id = opts.args[0];
        if (!id) {
          io.err("pw follow needs an id");
          return 2;
        }
        for await (const ev of api.stream(id, { from: numFlag("from") ?? 0 })) {
          if (ev.event === "chunk") io.out(String(ev.data.text).replace(/\n$/, ""));
          if (ev.event === "drop") io.out(`[dropped ${ev.data.droppedChars} chars]`);
          if (ev.event === "end") {
            io.out(`\u2014 stream ended (${String(ev.data.reason)})`);
            break;
          }
        }
        return 0;
      }
      case "input": {
        const id = opts.args[0];
        const text = opts.args.slice(1).join(" ");
        if (!id || !text) {
          io.err('pw input needs an id and text: pw input <id> "hello"');
          return 2;
        }
        const res = await api.input(id, text.endsWith("\n") ? text : text + "\n");
        io.out(`${res.wrote} chars written to ${res.id}`);
        return 0;
      }
      case "kill": {
        const id = opts.args[0];
        if (!id) {
          io.err("pw kill needs an id");
          return 2;
        }
        const kill = await api.kill(id, { force: opts.flags.force === true });
        io.out(`${kill.id} \u2014 ${kill.outcome} (pid ${kill.pid}, forced: ${kill.forced})`);
        return 0;
      }
      case "rm": {
        const id = opts.args[0];
        if (!id) {
          io.err("pw rm needs an id");
          return 2;
        }
        const res = await api.remove(id);
        io.out(`${id} removed: ${res.removed}; the life file stays at ${res.process.streamFile}`);
        return 0;
      }
      case "commands": {
        const cmds = await api.commands();
        if (!cmds.length) {
          io.out("(no saved commands)");
          return 0;
        }
        for (const c of cmds) io.out(`${c.name.padEnd(20)} ${c.command} ${c.args.join(" ")}${c.description ? "   \u2014 " + c.description : ""}`);
        return 0;
      }
      case "save": {
        const name = opts.args[0];
        const command = opts.args.slice(1).join(" ");
        if (!name || !command) {
          io.err('pw save needs a name and a command: pw save ping "ping -n 3 127.0.0.1"');
          return 2;
        }
        const saved = await api.saveCommand({
          name,
          command,
          description: typeof opts.flags.desc === "string" ? opts.flags.desc : "",
          tag: typeof opts.flags.tag === "string" ? opts.flags.tag : null
        });
        io.out(`saved ${saved.name}: ${saved.command}`);
        return 0;
      }
      case "unsave": {
        const name = opts.args[0];
        if (!name) {
          io.err("pw unsave needs a name");
          return 2;
        }
        await api.removeCommand(name);
        io.out(`dropped ${name}`);
        return 0;
      }
      default:
        io.err(`unknown command: ${opts.command}

${HELP}`);
        return 2;
    }
  } catch (err) {
    const e = err;
    io.err(`error${e.code ? ` (${e.code})` : ""}: ${e.message || String(err)}`);
    return 1;
  }
}
function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return /cli\.(js|ts)$/.test(entry);
}
if (isDirectRun()) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
async function runTests() {
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const a = parseCliArgs(["start", "python bar.py", "--name", "probe", "--follow"]);
  ok("the command and positional args are split", a.command === "start" && a.args.join("|") === "python bar.py", JSON.stringify(a));
  ok("a valued flag takes its value", a.flags.name === "probe", JSON.stringify(a.flags));
  ok("a bare flag becomes true", a.flags.follow === true, JSON.stringify(a.flags));
  const b = parseCliArgs(["--url=http://127.0.0.1:9999", "list"]);
  ok("--flag=value works", b.command === "list" && b.flags.url === "http://127.0.0.1:9999", JSON.stringify(b));
  ok("an empty argv asks for help", parseCliArgs([]).command === "help");
  const c = parseCliArgs(["output", "id-1", "--from", "400", "--channel", "stderr"]);
  ok("numeric flags survive parsing as strings", c.flags.from === "400" && c.flags.channel === "stderr", JSON.stringify(c.flags));
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { createWrapper } = await import("./processWrapper.js");
  const { createStreamHub } = await import("./streamHub.js");
  const { startApiServer } = await import("./apiServer.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-cli-"));
  const wrapper = createWrapper({ streamDir: path.join(dir, "streams"), graceMs: 300 });
  const hub = createStreamHub(wrapper);
  const api = await startApiServer({ wrapper, hub, port: 0, token: null, registryFile: path.join(dir, "data.yaml") });
  const client = createProcessClient({ baseUrl: api.url });
  const out = [];
  const errs = [];
  const io = { out: (s) => out.push(s), err: (s) => errs.push(s) };
  const cli = (argv) => runCli(argv, io, client);
  try {
    ok("help exits 0 and prints the usage", await cli(["help"]) === 0 && out.join("\n").includes("pw start"), out.join("\n").slice(0, 80));
    ok("an unknown command exits 2", await cli(["wat"]) === 2 && errs.join("\n").includes("unknown command"), errs.join("\n").slice(0, 60));
    out.length = 0;
    ok("health prints the module", await cli(["health"]) === 0 && out.join("\n").includes("processWrapper"), out.join("\n").slice(0, 100));
    const exe = `"${process.execPath}"`;
    out.length = 0;
    ok("start launches and prints the id", await cli(["start", `${exe} -e "console.log('cli-ran')"`, "--name", "cli-probe"]) === 0 && /cli-probe/.test(out.join("\n")), out.join("\n"));
    const startedId = out.join("\n").split(/\s+/)[0];
    await wrapper.awaitExit(startedId, 15e3);
    out.length = 0;
    ok("list prints the live table", await cli(["list"]) === 0 && out.join("\n").includes("cli-probe"), out.join("\n"));
    out.length = 0;
    errs.length = 0;
    ok("output prints the captured text", await cli(["output", startedId]) === 0 && out.join("\n").includes("cli-ran"), out.join("\n"));
    ok("output notes the offsets on stderr", /\d+ of \d+ chars/.test(errs.join("\n")), errs.join("\n"));
    out.length = 0;
    ok("show prints the full record", await cli(["show", startedId]) === 0 && out.join("\n").includes("streamFile"), out.join("\n").slice(0, 120));
    out.length = 0;
    ok("save stores a command", await cli(["save", "cli-saved", `${exe} -e "console.log(1)"`, "--desc", "from the cli"]) === 0 && out.join("\n").includes("cli-saved"), out.join("\n"));
    out.length = 0;
    ok("commands lists it", await cli(["commands"]) === 0 && out.join("\n").includes("from the cli"), out.join("\n"));
    out.length = 0;
    ok("unsave drops it", await cli(["unsave", "cli-saved"]) === 0 && out.join("\n").includes("dropped"), out.join("\n"));
    out.length = 0;
    ok("rm removes the finished record", await cli(["rm", startedId]) === 0 && out.join("\n").includes("removed: true"), out.join("\n"));
    out.length = 0;
    await cli(["start", `${exe} -e "console.log('up');process.stdin.on('data',d=>console.log('in:'+d.toString().trim()));setInterval(()=>{},60)"`, "--name", "cli-live"]);
    const liveId = out.join("\n").split(/\s+/)[0];
    await new Promise((r) => setTimeout(r, 500));
    out.length = 0;
    errs.length = 0;
    ok("input reaches the child through the cli", await cli(["input", liveId, "ping-from-cli"]) === 0 && out.join("\n").includes("chars written"), out.join("\n"));
    let sawAnswer = false;
    const answerDeadline = Date.now() + 5e3;
    while (Date.now() < answerDeadline) {
      out.length = 0;
      await cli(["output", liveId]);
      if (out.join("\n").includes("in:ping-from-cli")) {
        sawAnswer = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 80));
    }
    ok("the cli sees the child answer", sawAnswer, out.join("\n"));
    out.length = 0;
    ok("kill ends it with a force", await cli(["kill", liveId, "--force"]) === 0 && out.join("\n").includes("killed"), out.join("\n"));
    out.length = 0;
    ok("a bad id is a clean error, not a crash", await cli(["show", "no-such-id"]) === 1 && errs.join("\n").includes("not_found"), errs.join("\n"));
  } finally {
    await wrapper.shutdown().catch(() => {
    });
    await api.stop().catch(() => {
    });
  }
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[cli] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  parseCliArgs,
  runCli,
  runTests
};
//# sourceMappingURL=cli.js.map
