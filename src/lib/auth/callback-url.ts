/**
 * Where to send someone after sign-in (the ?callbackUrl= a deep link carries,
 * e.g. an email's /app/{slug}/tasks/{taskId}). Only a same-origin RELATIVE
 * path is accepted: no scheme, no host, no protocol-relative "//", no
 * backslashes or control characters (browsers treat "/\\evil.com" as a
 * host), and never back to the auth pages or the API. Anything else is
 * dropped, so the parameter can't become an open redirect. Pure.
 */

const BASE = "http://callback.invalid";
const BLOCKED_PREFIXES = ["/api/", "/sign-in", "/sign-up", "/sign-out"];

export const CALLBACK_HEADER = "x-pathname";

export function safeCallbackUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2000) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || ch === "\\") return null;
  }
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  if (BLOCKED_PREFIXES.some((p) => url.pathname === p || url.pathname.startsWith(p.endsWith("/") ? p : `${p}/`))) {
    return null;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/** /sign-in, carrying the path to come back to when there is a safe one. */
export function signInPath(callbackUrl: unknown): string {
  const safe = safeCallbackUrl(callbackUrl);
  return safe ? `/sign-in?callbackUrl=${encodeURIComponent(safe)}` : "/sign-in";
}
