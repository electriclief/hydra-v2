/**
 * @module windowMap
 * @description The ONE job: turn a registered "path" (an ADDRESS, not a launch command)
 *              into a real page URL an iframe can load. Scheme-less addresses get http;
 *              anything already carrying a scheme passes through untouched.
 * @intent The wrapper maps iframes — it never launches anything. A tab's path says
 *         WHERE its page answers; the thing that serves it is somebody else's business.
 */
/** True when the string already carries a scheme (http:, file:, data: …). */
export declare function hasScheme(path: string): boolean;
/** Address → page URL. "localhost:8088" → "http://localhost:8088" (browser adds the /). */
export declare function toPageUrl(path: string): string;
/** For display: the address with a protocol prefix we would add stripped back off. */
export declare function displayAddress(path: string): string;
export declare function runTests(): Promise<void>;
