import fs from "node:fs";
import os from "node:os";
import { execFile } from "node:child_process";
function execRunner(file, args, timeoutMs = 25e3) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout));
    });
  });
}
const defaultRunner = (file, args) => execRunner(file, args);
function buildPowerShellScript() {
  return [
    "$ErrorActionPreference='SilentlyContinue'",
    "$out=@{}",
    "$out.cpu=(Get-CimInstance Win32_Processor | Select-Object -First 1).Name",
    '$out.disks=@(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { @{ device=$_.DeviceID; freeMb=[math]::Round($_.FreeSpace/1MB); totalMb=[math]::Round($_.Size/1MB) } })',
    "$out.gpus=@(Get-CimInstance Win32_VideoController | ForEach-Object { $mb=0; if($_.AdapterRAM){$mb=[math]::Round($_.AdapterRAM/1MB)}; @{ name=$_.Name; adapterRamMb=$mb; driver=$_.DriverVersion } })",
    "$reg='HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}'",
    "$out.reg=@(Get-ChildItem $reg | ForEach-Object { $p=Get-ItemProperty $_.PSPath; if($p.'HardwareInformation.qwMemorySize'){ @{ name=$p.DriverDesc; vramMb=[math]::Round(([uint64]$p.'HardwareInformation.qwMemorySize')/1MB) } } })",
    "$rx='^(llama-server|llama-cli|llama|sd|sd-cli|stable-diffusion|comfyui|lolminer|srbminer-multi|xmrig|python|pythonw)(\\.exe)?$'",
    "$out.procs=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -match $rx } | ForEach-Object { @{ name=$_.Name; pid=$_.ProcessId; cmd=$_.CommandLine; wsMb=[math]::Round($_.WorkingSetSize/1MB) } })",
    "$out | ConvertTo-Json -Compress -Depth 5"
  ].join("; ");
}
function parsePowerShellJson(stdout) {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return null;
  }
}
function num(value) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
function gpuNameMatches(a, b) {
  const na = a.toLowerCase().replace(/\s+/g, " ").trim();
  const nb = b.toLowerCase().replace(/\s+/g, " ").trim();
  return na === nb || na.includes(nb) || nb.includes(na);
}
function resolveVram(name, adapterRamMb, registry, smi) {
  const fromSmi = smi.find((entry) => gpuNameMatches(entry.name, name));
  if (fromSmi && fromSmi.totalMb > 0) return { vramMb: fromSmi.totalMb, source: "nvidia-smi", memUsedMb: fromSmi.usedMb };
  const fromReg = registry.find((entry) => gpuNameMatches(entry.name, name));
  if (fromReg && fromReg.vramMb > 0) return { vramMb: fromReg.vramMb, source: "registry", memUsedMb: null };
  if (adapterRamMb && adapterRamMb > 0) return { vramMb: adapterRamMb, source: "adapterram", memUsedMb: null };
  return { vramMb: null, source: "unknown", memUsedMb: null };
}
const GPU_APP = /^(llama-server|llama-cli|llama|sd|sd-cli|stable-diffusion|comfyui)(\.exe)?$/;
const MINER = /^(lolminer|srbminer-multi|xmrig)(\.exe)?$/;
const PY_GPU_CMD = /torch|comfy|llama|diffus|vulkan|stable-diffusion|wan|jupyter/i;
function classifyObserved(procs) {
  const out = [];
  for (const proc of procs) {
    const name = String(proc.name ?? "").toLowerCase();
    if (GPU_APP.test(name)) out.push({ name: proc.name, pid: proc.pid, reason: "gpu app" });
    else if (MINER.test(name)) out.push({ name: proc.name, pid: proc.pid, reason: "miner" });
    else if (/^pythonw?(\.exe)?$/.test(name) && proc.cmd && PY_GPU_CMD.test(proc.cmd)) {
      out.push({ name: proc.name, pid: proc.pid, reason: "python gpu cmdline" });
    }
  }
  return out;
}
async function sampleLoad() {
  const snap = () => os.cpus().map((core) => ({ idle: core.times.idle, total: core.times.user + core.times.nice + core.times.sys + core.times.idle + core.times.irq }));
  const first = snap();
  await new Promise((resolve) => setTimeout(resolve, 220));
  const second = snap();
  let idleDelta = 0;
  let totalDelta = 0;
  for (let i = 0; i < Math.min(first.length, second.length); i++) {
    idleDelta += second[i].idle - first[i].idle;
    totalDelta += second[i].total - first[i].total;
  }
  if (totalDelta <= 0) return null;
  const raw = 100 * (1 - idleDelta / totalDelta);
  return Math.max(0, Math.min(100, Math.round(raw * 10) / 10));
}
let cache = null;
async function collectReads(options = {}) {
  const ttl = options.ttlMs ?? 4e3;
  const injected = Boolean(options.runner || options.nvidiaRunner);
  if (!options.force && !injected && cache && Date.now() - cache.at < ttl) return cache.value;
  const notes = [];
  const cpus = os.cpus();
  const loadPct = await sampleLoad();
  let disks = [];
  let gpus = [];
  let observed = [];
  let cpuName = cpus[0]?.model ?? "unknown";
  if (process.platform === "win32") {
    try {
      const runner = options.runner ?? defaultRunner;
      const encoded = Buffer.from(buildPowerShellScript(), "utf16le").toString("base64");
      const stdout = await runner("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded]);
      const parsed = parsePowerShellJson(stdout);
      if (!parsed) {
        notes.push("powershell answered nothing readable \u2014 disks/gpus/observed are partial");
      } else {
        if (typeof parsed.cpu === "string" && parsed.cpu.trim()) cpuName = parsed.cpu.trim();
        const rawDisks = Array.isArray(parsed.disks) ? parsed.disks : [];
        disks = rawDisks.map((entry) => {
          const item = entry;
          const device = typeof item.device === "string" ? item.device : null;
          const freeMb2 = num(item.freeMb);
          const totalMb2 = num(item.totalMb);
          return device && totalMb2 !== null ? { device, freeMb: freeMb2 ?? 0, totalMb: totalMb2 } : null;
        }).filter((entry) => entry !== null);
        const registry = (Array.isArray(parsed.reg) ? parsed.reg : []).map((entry) => {
          const item = entry;
          const name = typeof item.name === "string" ? item.name : null;
          const vramMb = num(item.vramMb);
          return name && vramMb ? { name, vramMb } : null;
        }).filter((entry) => entry !== null);
        const rawGpus = (Array.isArray(parsed.gpus) ? parsed.gpus : []).map((entry) => {
          const item = entry;
          const name = typeof item.name === "string" ? item.name.trim() : null;
          return name ? { name, adapterRamMb: num(item.adapterRamMb) } : null;
        }).filter((entry) => entry !== null);
        const procs = (Array.isArray(parsed.procs) ? parsed.procs : []).map((entry) => {
          const item = entry;
          const name = typeof item.name === "string" ? item.name : null;
          const pid = num(item.pid);
          return name && pid !== null ? { name, pid, cmd: typeof item.cmd === "string" ? item.cmd : null } : null;
        }).filter((entry) => entry !== null);
        let smi = [];
        const nvidiaRunner = options.nvidiaRunner ?? defaultRunner;
        try {
          const smiOut = await nvidiaRunner("nvidia-smi", ["--query-gpu=name,memory.total,memory.used", "--format=csv,noheader,nounits"]);
          smi = smiOut.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
            const parts = line.split(",").map((piece) => piece.trim());
            const totalMb2 = num(parts[1]);
            const usedMb = num(parts[2]);
            return parts[0] && totalMb2 !== null ? { name: parts[0], totalMb: totalMb2, usedMb } : null;
          }).filter((entry) => entry !== null);
        } catch {
          smi = [];
        }
        gpus = rawGpus.map((gpu) => {
          const resolved = resolveVram(gpu.name, gpu.adapterRamMb, registry, smi);
          return { name: gpu.name, vramMb: resolved.vramMb, vramSource: resolved.source, memUsedMb: resolved.memUsedMb };
        });
        for (const entry of smi) {
          if (!gpus.some((gpu) => gpuNameMatches(gpu.name, entry.name))) {
            gpus.push({ name: entry.name, vramMb: entry.totalMb, vramSource: "nvidia-smi", memUsedMb: entry.usedMb });
          }
        }
        observed = classifyObserved(procs);
      }
    } catch {
      notes.push("the powershell read failed \u2014 disks/gpus/observed are partial this poll");
    }
  } else {
    notes.push(`reads are windows-first; on ${process.platform} disks/gpus are not read`);
  }
  const declared = options.shares ?? [];
  const shares = declared.map((entry) => {
    const label = typeof entry === "string" ? null : entry.label ?? null;
    const sharePath = typeof entry === "string" ? entry : entry.path;
    let exists = false;
    try {
      exists = fs.existsSync(sharePath);
    } catch {
      exists = false;
    }
    const letter = sharePath.replace(/\\/g, "/").charAt(0).toUpperCase();
    const disk = letter ? disks.find((candidate) => candidate.device.toUpperCase().startsWith(letter)) : void 0;
    return { label, path: sharePath, exists, freeMb: disk ? disk.freeMb : null, totalMb: disk ? disk.totalMb : null };
  });
  const totalMb = Math.round(os.totalmem() / (1024 * 1024));
  const freeMb = Math.round(os.freemem() / (1024 * 1024));
  const value = {
    collectedAt: (/* @__PURE__ */ new Date()).toISOString(),
    node: os.hostname(),
    platform: process.platform,
    cpu: { model: cpuName, cores: cpus.length, loadPct },
    ram: { totalMb, freeMb },
    gpus,
    gpusObserved: observed,
    disks,
    shares,
    notes
  };
  if (!injected) cache = { at: Date.now(), value };
  return value;
}
function loadShareList(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(parsed)) return [];
    const out = [];
    for (const entry of parsed) {
      if (typeof entry === "string" && entry.trim()) out.push({ path: entry.trim() });
      else if (entry && typeof entry === "object" && typeof entry.path === "string") {
        const item = entry;
        out.push({ path: item.path, ...typeof item.label === "string" ? { label: item.label } : {} });
      }
    }
    return out;
  } catch {
    return [];
  }
}
async function runTests() {
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  const fakePs = JSON.stringify({
    cpu: "Fake Ryzen 9 5950X",
    disks: [
      { device: "C:", freeMb: 1e5, totalMb: 5e5 },
      { device: "D:", freeMb: 25e4, totalMb: 1e6 }
    ],
    gpus: [{ name: "AMD Radeon RX 6800", adapterRamMb: 4095, driver: "1.2.3" }],
    reg: [{ name: "AMD Radeon RX 6800", vramMb: 16384 }],
    procs: [
      { name: "lolMiner.exe", pid: 10, cmd: "lolMiner --algo", wsMb: 500 },
      { name: "python.exe", pid: 11, cmd: 'python -c "import torch"', wsMb: 900 },
      { name: "notepad.exe", pid: 12, cmd: "notepad", wsMb: 5 },
      { name: "python.exe", pid: 13, cmd: "python plain_server.py", wsMb: 50 }
    ]
  });
  const runner = async () => fakePs;
  const nvidiaRunner = async () => {
    throw new Error("no nvidia here");
  };
  const reads = await collectReads({ runner, nvidiaRunner, shares: [{ label: "models", path: "C:\\Hydra\\shared\\models" }] });
  ok("reads: a full shape comes back", reads.cpu.cores >= 1 && reads.ram.totalMb > 0 && Array.isArray(reads.disks) && Array.isArray(reads.gpus));
  ok("reads: the machine cpu model wins over the fake wmi name", reads.cpu.model.length > 0);
  ok("reads: disks parse with free/total", reads.disks.length === 2 && reads.disks[0].device === "C:" && reads.disks[0].freeMb === 1e5);
  ok("reads: vram truth beats the 4095 adapterram cap (registry)", reads.gpus[0].vramMb === 16384 && reads.gpus[0].vramSource === "registry", JSON.stringify(reads.gpus[0]));
  ok("reads: observed keeps the miner", reads.gpusObserved.some((p) => p.name === "lolMiner.exe" && p.reason === "miner"));
  ok("reads: observed keeps python-with-torch (cmdline)", reads.gpusObserved.some((p) => p.pid === 11 && p.reason === "python gpu cmdline"));
  ok("reads: observed drops notepad and the plain python", !reads.gpusObserved.some((p) => p.pid === 12 || p.pid === 13));
  ok("reads: a share resolves its volume space (C:)", reads.shares[0].freeMb === 1e5 && reads.shares[0].label === "models");
  ok("reads: a load sample is a number", typeof reads.cpu.loadPct === "number");
  const first = await collectReads({});
  const second = await collectReads({});
  ok("reads: the cache answers the second poll identically", first.collectedAt === second.collectedAt);
  const forced = await collectReads({ force: true });
  ok("reads: force re-reads (never claims an older moment)", forced.collectedAt >= first.collectedAt);
  ok("shares: a missing file is simply none", loadShareList("C:/definitely/not/here/shares.json").length === 0);
  if (process.platform === "win32") {
    ok("reads: the real machine answers (not a mock)", first.node.length > 0 && first.cpu.cores >= 1 && first.ram.totalMb > 0);
    ok("reads: the real machine has at least one disk", first.disks.length >= 1);
  }
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[resourceRead] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  buildPowerShellScript,
  classifyObserved,
  collectReads,
  loadShareList,
  parsePowerShellJson,
  runTests
};
//# sourceMappingURL=resourceRead.js.map
