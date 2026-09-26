/**
 * Escaping for email templates (0A Fix 9). Every interpolated value goes
 * through escapeHtml; every link through safeHref; every subject through
 * subjectLine. Member-controlled text (task titles, org names, expense
 * descriptions, inviter names) must never become markup, a javascript:
 * link or an injected header.
 */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

/**
 * An absolute http(s) URL, escaped for an href attribute. Anything else
 * (javascript:, data:, relative paths) throws: templates only link to the
 * app's own absolute URLs.
 */
export function safeHref(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError("email links must be absolute URLs");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new TypeError("email links must be http(s)");
  }
  return escapeHtml(parsed.toString());
}

/** Replaces every C0 control character and DEL with a space. */
function stripControl(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    out += code < 0x20 || code === 0x7f ? " " : ch;
  }
  return out;
}

/** A subject (or other header) value: one line, no control characters, bounded. */
export function subjectLine(text: string, max = 200): string {
  const oneLine = stripControl(text).replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/** A display name for a "Name <address>" header: no quotes, brackets or control characters. */
export function displayName(text: string, max = 80): string {
  return subjectLine(text.replace(/["<>\\]/g, ""), max);
}
