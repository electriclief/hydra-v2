/**
 * inventory.js - the second job of the Resource Manager: say what this node IS doing, not just what it could book.
 *
 * The operator's rule (2026-11-15): "should be tracking all apis, all running processes (not windows stuff) - should
 * alert if unusual cpu/gpu/disk activity occurs - have Echidna either find the problem, or re-define unusual".
 *
 * So this file has exactly three responsibilities and no opinions beyond them:
 *   1. collect()   - one cheap pass: processes that belong to Hydra or its users, listening ports joined to their owner,
 *                    CPU/GPU/disk/VRAM gauges. Windows system noise is filtered by PATH, not by a name list, because
 *                    "svchost" is not the same thing as "a program a person started".
 *   2. probeApis() - every door this node declares (library/api-index.json + each module's join.json) asked directly:
 *                    ok / slow / down, with milliseconds. A door that is not listening is a fact, not an error.
 *   3. publish()   - node.<ref>.inventory and node.<ref>.apis into State on a cadence, so the Menu, Phoenix and Echidna
 *                    read one measurement instead of each shelling out.
 *
 * Nothing here enforces anything. It measures, and it publishes what it measured.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const execRunner = (file, args, timeoutMs = 20000) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err); else resolve(String(stdout));
    });
  });

/** Windows itself, and the things Windows runs on its own behalf. Matched against the executable PATH. */
const SYSTEM_PATH = /^[a-z]:\\windows\\|^[a-z]:\\program files\\windows apps\\|\\windowsapps\\/i;
const SYSTEM_NAMES = /^(system|registry|memory compression|msmpeng|smartscreen|searchindexer|fontdrvhost|dwm|csrss|wininit|winlogon|services|lsass|svchost|taskhostw|dllhost|sihost|ctfmon|explorer|runtimebroker|shellexperiencehost|startmenuexperiencehost|searchapp|textinputhost|applicationframehost|wmiprvse|wudfhost|audiodg|spoolsv|trustedinstaller|tiworker|msiexec|backgroundtaskhost)$/i;

function num(v) { const n = typeof v === 'number' ? v : Number(v); return Number.isFinite(n) ? n : null; }
function mb(bytes) { const n = num(bytes); return n === null ? null : Math.round(n / 1048576); }

function buildScript() {
  return [
    "$ErrorActionPreference='SilentlyContinue'",
    "$o=@{}",
    // every process with a real path, minus Windows' own; the path is what separates "a program" from "the OS"
    "$o.procs=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath } | ForEach-Object { @{ name=$_.Name; pid=$_.ProcessId; ppid=$_.ParentProcessId; path=$_.ExecutablePath; cmd=$_.CommandLine; wsMb=[math]::Round($_.WorkingSetSize/1MB) } })",
    // who is listening - the honest answer to "is that door up", before any HTTP probe
    "$o.listen=@(Get-NetTCPConnection -State Listen | ForEach-Object { @{ port=[int]$_.LocalPort; pid=[int]$_.OwningProcess; addr=[string]$_.LocalAddress } })",
    "$o.mem=@{ totalMb=[math]::Round((Get-CimInstance Win32_OperatingSystem).TotalVisibleMemorySize/1KB); freeMb=[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1KB) }",
    "$o.disks=@(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { @{ device=$_.DeviceID; freeMb=[math]::Round($_.FreeSpace/1MB); totalMb=[math]::Round($_.Size/1MB) } })",
    // disk ACTIVITY (not just free space): the counter that moves when something is hammering a spindle
    "$o.diskIo=@(Get-CimInstance Win32_PerfFormattedData_PerfDisk_LogicalDisk | Where-Object { $_.Name -ne '_Total' } | ForEach-Object { @{ name=[string]$_.Name; busyPct=[int]$_.PercentDiskTime; readKb=[math]::Round($_.DiskReadBytesPersec/1KB); writeKb=[math]::Round($_.DiskWriteBytesPersec/1KB) } })",
    // AdapterRAM is a 32-bit field: it reports 4095 MB for every card with more than 4 GB. The registry holds the truth.
    "$o.reg=@(Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}' | ForEach-Object { $p=Get-ItemProperty $_.PSPath; if($p.'HardwareInformation.qwMemorySize'){ @{ name=$p.DriverDesc; vramMb=[math]::Round(([uint64]$p.'HardwareInformation.qwMemorySize')/1MB) } } })",
    "$o.wmiGpus=@(Get-CimInstance Win32_VideoController | ForEach-Object { @{ name=$_.Name; driver=$_.DriverVersion; ramMb=[math]::Round($_.AdapterRAM/1MB) } })",
    "$o | ConvertTo-Json -Compress -Depth 6"
  ].join('; ');
}

/** nvidia-smi is optional: absent is not an error, it means this node has no NVIDIA card. */
async function gpuGauges(runner = execRunner) {
  const query = 'name,utilization.gpu,temperature.gpu,power.draw,power.limit,memory.used,memory.total,clocks.sm';
  try {
    const out = await runner('nvidia-smi', [`--query-gpu=${query}`, '--format=csv,noheader,nounits'], 8000);
    return String(out).trim().split(/\r?\n/).filter(Boolean).map((line) => {
      const [name, util, temp, power, limit, memUsed, memTotal, clock] = line.split(',').map((s) => s.trim());
      return { name, utilPct: num(util), tempC: num(temp), powerW: num(power), powerLimitW: num(limit),
               memUsedMb: num(memUsed), memTotalMb: num(memTotal), clockMhz: num(clock) };
    });
  } catch {
    return [];
  }
}

function cpuLoadPct() {
  const snap = () => os.cpus().map((c) => ({ idle: c.times.idle, total: c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq }));
  const first = snap();
  return new Promise((resolve) => {
    setTimeout(() => {
      const second = snap();
      let idle = 0, total = 0;
      for (let i = 0; i < Math.min(first.length, second.length); i++) {
        idle += second[i].idle - first[i].idle;
        total += second[i].total - first[i].total;
      }
      resolve(total > 0 ? Math.max(0, Math.min(100, Math.round(100 * (1 - idle / total) * 10) / 10)) : null);
    }, 200);
  });
}

/**
 * One measurement of this node. `runner` is injectable so the shape can be tested without the box it runs on.
 * The filter is the interesting part: a process is INCLUDED when its executable lives outside C:\Windows and its name
 * is not one of Windows' own helpers. Everything else is the operating system doing its job and none of our business.
 */
export async function collect({ runner = execRunner, limit = 250 } = {}) {
  const out = { at: new Date().toISOString(), host: os.hostname(), platform: process.platform, notes: [] };
  out.cpu = { name: os.cpus()[0]?.model ?? 'unknown', cores: os.cpus().length, loadPct: await cpuLoadPct() };
  out.mem = { totalMb: mb(os.totalmem()), freeMb: mb(os.freemem()) };
  out.gpus = await gpuGauges(runner);

  if (process.platform === 'win32') {
    let parsed = null;
    try {
      const encoded = Buffer.from(buildScript(), 'utf16le').toString('base64');
      const stdout = await runner('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], 20000);
      const start = stdout.indexOf('{'), end = stdout.lastIndexOf('}');
      if (start >= 0 && end > start) parsed = JSON.parse(stdout.slice(start, end + 1));
    } catch (error) {
      out.notes.push(`powershell pass failed: ${error.message}`);
    }
    if (!parsed) out.notes.push('no process/listener data - the box answered nothing readable');
    else {
      const rawProcs = (Array.isArray(parsed.procs) ? parsed.procs : [parsed.procs]).filter(Boolean);
      const kept = [];
      for (const p of rawProcs) {
        const exe = String(p.path ?? '');
        const name = String(p.name ?? '').replace(/\.exe$/i, '');
        if (!exe || SYSTEM_PATH.test(exe) || SYSTEM_NAMES.test(name)) continue;
        kept.push({ name: p.name, pid: num(p.pid), ppid: num(p.ppid), wsMb: num(p.wsMb),
                    path: exe, cmd: String(p.cmd ?? '').slice(0, 400) });
      }
      out.processCount = rawProcs.length;
      out.filteredCount = kept.length;
      out.processes = kept.slice(0, limit);

      const rawListen = (Array.isArray(parsed.listen) ? parsed.listen : []).filter(Boolean);
      const byPid = new Map(kept.map((p) => [p.pid, p.name]));
      out.listening = rawListen.map((l) => ({
        port: num(l.port), addr: String(l.addr ?? ''),
        pid: num(l.pid), owner: byPid.get(num(l.pid)) ?? null,
      })).filter((l) => l.port !== null);
      out.listenCount = out.listening.length;

      // no nvidia-smi, or it could not answer: report the card by name so a GPU-less AMD box is not listed as GPU-less
      if (!out.gpus.length && Array.isArray(parsed.wmiGpus)) {
        const reg = (Array.isArray(parsed.reg) ? parsed.reg : []).filter(Boolean);
        const regVram = (name) => {
          const n = String(name).toLowerCase().replace(/\s+/g, ' ').trim();
          const hit = reg.find((r) => {
            const rn = String(r.name ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
            return rn && (rn === n || rn.includes(n) || n.includes(rn));
          });
          return hit ? num(hit.vramMb) : null;
        };
        out.gpus = parsed.wmiGpus.filter(Boolean).map((g) => {
          const name = String(g.name ?? '');
          const vram = regVram(name);
          const wmi = num(g.ramMb);
          return {
            name, driver: String(g.driver ?? ''),
            memTotalMb: vram ?? (wmi && wmi < 4095 ? wmi : null),
            memSource: vram ? 'registry' : (wmi && wmi < 4095 ? 'wmi' : 'unknown (AdapterRAM caps at 4095)'),
            utilPct: null, tempC: null, source: 'wmi', note: 'no utilisation/temperature driver on this platform',
          };
        }).filter((g) => g.name && !/basic (display|render)|remote display|spacedesk/i.test(g.name));
      }
      if (parsed.mem) out.mem = { totalMb: num(parsed.mem.totalMb) ?? out.mem.totalMb, freeMb: num(parsed.mem.freeMb) ?? out.mem.freeMb };
      out.disks = (Array.isArray(parsed.disks) ? parsed.disks : []).filter(Boolean).map((d) => ({
        device: String(d.device ?? ''), freeMb: num(d.freeMb), totalMb: num(d.totalMb),
      }));
      out.diskIo = (Array.isArray(parsed.diskIo) ? parsed.diskIo : []).filter(Boolean).map((d) => ({
        name: String(d.name ?? ''), busyPct: num(d.busyPct), readKb: num(d.readKb), writeKb: num(d.writeKb),
      }));
    }
  } else {
    out.notes.push('process inventory is Windows-shaped in this build');
  }
  return out;
}

/**
 * Every door this node declares, asked for an answer. Sources, in order of authority:
 *   library/api-index.json  - a published promise: door + the exact call another module uses
 *   module/*\/join.json      - the module's own declaration of its port and how it starts
 * The probe is a GET on the health route the door actually serves; a 404 from a live door still counts as UP, because
 * the process answered, and "right host, wrong route" must not be reported as "down".
 */
export async function probeApis({ root = process.cwd(), timeoutMs = 2500, only = null } = {}) {
  const started = new Date().toISOString();
  const targets = [];
  const indexFile = path.join(root, 'library', 'api-index.json');
  try {
    const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    for (const s of index.services ?? []) {
      if (!s.door || !s.call) continue;
      // "runs as a script", "http://<beast>:8130/..." - neither is a door this node can ask; probing them produces a
      // fake 'down' that makes the whole list unreadable.
      if (!/^https?:\/\/[^<>\s]+$/i.test(String(s.door))) continue;
      const route = String(s.call).split(' ').find((t) => t.startsWith('/')) ?? '/health';
      targets.push({ id: `api:${s.id}`, title: s.title, owner: s.owner, base: String(s.door).replace(/\/$/, ''), route, source: 'api-index' });
    }
  } catch { /* an absent index is a fact: no published APIs yet */ }

  const moduleDir = path.join(root, 'module');
  try {
    for (const name of fs.readdirSync(moduleDir)) {
      const joinFile = path.join(moduleDir, name, 'join.json');
      if (!fs.existsSync(joinFile)) continue;
      try {
        const j = JSON.parse(fs.readFileSync(joinFile, 'utf8'));
        if (!j.port) continue;
        const host = j.host && j.host !== '0.0.0.0' ? j.host : '127.0.0.1';
        targets.push({ id: `door:${name}`, title: j.what ?? name, owner: name,
                       base: `http://${host}:${j.port}`, route: '/health', source: 'join.json' });
      } catch { /* a malformed join.json is the module's problem, not the probe's */ }
    }
  } catch { /* no module dir: nothing to declare */ }

  const seen = new Set();
  const entries = [];
  for (const t of targets) {
    if (only && !t.id.includes(only)) continue;
    const key = `${t.base}${t.route}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const t0 = Date.now();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let status = 'down', http = null, note = null;
    try {
      const res = await fetch(t.base + t.route, { signal: ac.signal, headers: { accept: 'application/json' } });
      http = res.status;
      status = res.status < 400 ? 'ok' : 'answered';
    } catch (error) {
      note = error.name === 'AbortError' ? `no answer in ${timeoutMs} ms` : error.message;
    } finally { clearTimeout(timer); }
    const ms = Date.now() - t0;
    if (status === 'ok' && ms > Math.max(800, timeoutMs / 2)) status = 'slow';
    entries.push({ ...t, status, http, ms, note });
  }
  entries.sort((a, b) => (a.status === b.status ? b.ms - a.ms : a.status.localeCompare(b.status)));
  const tally = (s) => entries.filter((e) => e.status === s).length;
  return { at: started, count: entries.length, ok: tally('ok'), answered: tally('answered'), slow: tally('slow'),
           down: tally('down'), entries };
}

/** Publish one measured fact into a State door. Failure to publish is reported, never thrown at the caller. */
export async function publishState({ stateUrl, name, content, timeoutMs = 2000 }) {
  if (!stateUrl) return { ok: false, error: 'no state url' };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${stateUrl.replace(/\/$/, '')}/api/state/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, content }),
      signal: ac.signal,
    });
    return { ok: res.ok, status: res.status };
  } catch (error) {
    return { ok: false, error: error.name === 'AbortError' ? 'timeout' : error.message };
  } finally { clearTimeout(timer); }
}

/**
 * The loop that makes the register a live picture. Cheap by design: one pass every `intervalMs` (30 s default), and the
 * two entries are published together so a reader never sees an inventory that disagrees with its API list.
 */
export function startInventoryLoop({ ref, stateUrl = 'http://127.0.0.1:8127', intervalMs = 30000, root = process.cwd(),
                                     onSample = null, quiet = false } = {}) {
  let last = null;
  let timer = null;
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const [inv, apis] = await Promise.all([collect({}), probeApis({ root })]);
      last = { inv, apis, at: new Date().toISOString() };
      const findings = [];
      if (ref) {
        const a = await publishState({ stateUrl, name: `node.${ref}.inventory`, content: { ...inv, source: 'ResourceManager' } });
        if (!a.ok) findings.push(`inventory publish failed: ${a.error ?? a.status}`);
        const b = await publishState({ stateUrl, name: `node.${ref}.apis`, content: { ...apis, source: 'ResourceManager' } });
        if (!b.ok) findings.push(`apis publish failed: ${b.error ?? b.status}`);
      }
      if (onSample) { try { await onSample(last); } catch (e) { findings.push(`onSample: ${e.message}`); } }
      if (!quiet && findings.length) console.log(`  inventory: ${findings.join(' | ')}`);
    } catch (error) {
      if (!quiet) console.log(`  inventory pass failed: ${error.message}`);
    }
  };
  void tick();
  timer = setInterval(() => void tick(), intervalMs);
  return {
    stop() { stopped = true; if (timer) clearInterval(timer); },
    last: () => last,
    now: () => tick(),
  };
}
