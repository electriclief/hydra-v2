import fs from "node:fs";
import path from "node:path";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2"
};
function contentTypeFor(file) {
  return MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}
function resolveInside(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }
  const clean = path.normalize(decoded).replace(/^[/\\]+/, "");
  const full = path.resolve(root, clean);
  const rootResolved = path.resolve(root);
  if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) return null;
  return full;
}
function notFound(res) {
  const body = JSON.stringify(
    { error: { code: "no_route", message: "nothing static at this path \u2014 the API is at /api/state, the agent door at POST /mcp, the live feed at /api/state/stream" } },
    null,
    2
  );
  res.writeHead(404, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  res.end(body);
}
function serveStatic(req, res, options = {}) {
  const root = options.root ?? path.join(process.cwd(), "public");
  let target = resolveInside(root, req.url ?? "/");
  if (!target) {
    notFound(res);
    return { status: 404, file: null };
  }
  try {
    if (fs.statSync(target).isDirectory()) target = path.join(target, "index.html");
  } catch {
    notFound(res);
    return { status: 404, file: null };
  }
  try {
    const data = fs.readFileSync(target);
    res.writeHead(200, {
      "content-type": contentTypeFor(target),
      "content-length": data.length,
      "cache-control": "no-cache"
    });
    res.end(data);
    return { status: 200, file: target };
  } catch {
    notFound(res);
    return { status: 404, file: null };
  }
}
async function runTests() {
  const http = await import("node:http");
  const os = await import("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "st-static-"));
  fs.mkdirSync(path.join(dir, "sub"), { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><h1>hi</h1>");
  fs.writeFileSync(path.join(dir, "sub", "page.html"), "<h1>sub</h1>");
  fs.writeFileSync(path.join(dir, "style.css"), "body{}");
  const results = [];
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL ${label}${extra ? " :: " + extra : ""}`);
    results.push(`${cond ? "pass" : "FAIL"} ${label}`);
  };
  ok("mime map: html", contentTypeFor("x.html").startsWith("text/html"));
  ok("mime map: js", contentTypeFor("x.js").startsWith("text/javascript"));
  ok("mime map: unknown falls back", contentTypeFor("x.zzz") === "application/octet-stream");
  const inside = (r) => r === null || r === path.resolve(dir) || r.startsWith(path.resolve(dir) + path.sep);
  const t1 = resolveInside(dir, "/../../etc/passwd");
  const t2 = resolveInside(dir, "C:/Windows/win.ini");
  ok("traversal cannot escape the root", inside(t1) && inside(t2) && t2 === null, `${t1} | ${t2}`);
  ok("a normal path resolves inside", resolveInside(dir, "/sub/page.html") === path.resolve(dir, "sub", "page.html"));
  const server = http.createServer((req, res) => {
    serveStatic(req, res, { root: dir });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = server.address().port;
  const index = await fetch(`http://127.0.0.1:${port}/`);
  ok("index serves at the root", index.status === 200 && (await index.text()).includes("<h1>hi</h1>"));
  ok("css serves with its mime", (await fetch(`http://127.0.0.1:${port}/style.css`)).headers.get("content-type")?.startsWith("text/css") === true);
  const missing = await fetch(`http://127.0.0.1:${port}/nope`);
  ok("a miss answers 404 naming the API", missing.status === 404 && (await missing.text()).includes("/api/state"));
  await new Promise((resolve) => server.close(() => resolve()));
  const failed = results.filter((r) => r.startsWith("FAIL"));
  console.log(`[staticFiles] ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log(failed.join("\n"));
}
export {
  contentTypeFor,
  resolveInside,
  runTests,
  serveStatic
};
//# sourceMappingURL=staticFiles.js.map
