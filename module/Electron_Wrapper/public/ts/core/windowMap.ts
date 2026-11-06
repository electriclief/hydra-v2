/**
 * @module windowMap
 * @description The ONE job: turn a registered "path" (an ADDRESS, not a launch command)
 *              into a real page URL an iframe can load. Scheme-less addresses get http;
 *              anything already carrying a scheme passes through untouched.
 * @intent The wrapper maps iframes — it never launches anything. A tab's path says
 *         WHERE its page answers; the thing that serves it is somebody else's business.
 */

// --- Function Definitions ---

const SCHEME = /^(https?|file|data|about|chrome(-extension)?|blob):/i;

/** True when the string already carries a scheme (http:, file:, data: …). */
export function hasScheme(path: string): boolean {
  return SCHEME.test(path.trim());
}

/** Address → page URL. "localhost:8088" → "http://localhost:8088" (browser adds the /). */
export function toPageUrl(path: string): string {
  const p = (path ?? '').trim();
  if (p === '') throw new Error('toPageUrl: empty path');
  if (hasScheme(p)) return p;
  return `http://${p}`;
}

/** For display: the address with a protocol prefix we would add stripped back off. */
export function displayAddress(path: string): string {
  const p = (path ?? '').trim();
  return p.toLowerCase().startsWith('http://') ? p.slice(7) : p;
}

// --- Built-in Test Suite ---

export async function runTests(): Promise<void> {
  const ok = (label: string, cond: boolean, extra = ''): void => {
    console.assert(cond, `FAIL windowMap :: ${label}${extra ? ' :: ' + extra : ''}`);
  };

  ok('a bare localhost address gets http', toPageUrl('localhost:8088') === 'http://localhost:8088');
  ok('a LAN address gets http', toPageUrl('192.168.1.100:8127/x') === 'http://192.168.1.100:8127/x');
  ok('an http address passes through', toPageUrl('http://x/y') === 'http://x/y');
  ok('an https address passes through', toPageUrl('https://example.com') === 'https://example.com');
  ok('a file address passes through', toPageUrl('file:///C:/tmp/a.html') === 'file:///C:/tmp/a.html');
  ok('a data address passes through', toPageUrl('data:text/html,hi') === 'data:text/html,hi');
  ok('whitespace is trimmed', toPageUrl('  localhost:99  ') === 'http://localhost:99');
  ok('scheme detection agrees', hasScheme('http://a') && hasScheme('FILE://x') && !hasScheme('localhost:1'));
  ok('display strips the http we add', displayAddress('http://localhost:8088') === 'localhost:8088');
  ok('display leaves a foreign scheme alone', displayAddress('https://a') === 'https://a');

  let threw = false;
  try {
    toPageUrl('   ');
  } catch {
    threw = true;
  }
  ok('an empty path is refused loudly', threw);
}
