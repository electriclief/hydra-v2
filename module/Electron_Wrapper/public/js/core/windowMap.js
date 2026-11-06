const SCHEME = /^(https?|file|data|about|chrome(-extension)?|blob):/i;
function hasScheme(path) {
  return SCHEME.test(path.trim());
}
function toPageUrl(path) {
  const p = (path ?? "").trim();
  if (p === "") throw new Error("toPageUrl: empty path");
  if (hasScheme(p)) return p;
  return `http://${p}`;
}
function displayAddress(path) {
  const p = (path ?? "").trim();
  return p.toLowerCase().startsWith("http://") ? p.slice(7) : p;
}
async function runTests() {
  const ok = (label, cond, extra = "") => {
    console.assert(cond, `FAIL windowMap :: ${label}${extra ? " :: " + extra : ""}`);
  };
  ok("a bare localhost address gets http", toPageUrl("localhost:8088") === "http://localhost:8088");
  ok("a LAN address gets http", toPageUrl("192.168.1.100:8127/x") === "http://192.168.1.100:8127/x");
  ok("an http address passes through", toPageUrl("http://x/y") === "http://x/y");
  ok("an https address passes through", toPageUrl("https://example.com") === "https://example.com");
  ok("a file address passes through", toPageUrl("file:///C:/tmp/a.html") === "file:///C:/tmp/a.html");
  ok("a data address passes through", toPageUrl("data:text/html,hi") === "data:text/html,hi");
  ok("whitespace is trimmed", toPageUrl("  localhost:99  ") === "http://localhost:99");
  ok("scheme detection agrees", hasScheme("http://a") && hasScheme("FILE://x") && !hasScheme("localhost:1"));
  ok("display strips the http we add", displayAddress("http://localhost:8088") === "localhost:8088");
  ok("display leaves a foreign scheme alone", displayAddress("https://a") === "https://a");
  let threw = false;
  try {
    toPageUrl("   ");
  } catch {
    threw = true;
  }
  ok("an empty path is refused loudly", threw);
}
export {
  displayAddress,
  hasScheme,
  runTests,
  toPageUrl
};
//# sourceMappingURL=windowMap.js.map
