/**
 * Redaction of secrets and personal data from free text: job errors
 * (Job.lastError, OrgIntegration.lastError, Event.googleSyncError), log lines
 * and Sentry events. Pure and dependency-free, so the browser Sentry client
 * can use it too.
 *
 * What is removed:
 * - email addresses;
 * - bearer tokens and Basic credentials;
 * - API-key shapes (Anthropic, OpenAI-style sk-, Resend re_, Google AIza and
 *   ya29./1// OAuth tokens, GitHub, Slack, Vercel Blob, Stripe-style keys);
 * - JWTs;
 * - credentials inside connection URLs (postgres://user:pass@host);
 * - URL query strings and fragments (they carry signatures and tokens);
 * - the token segment of the app's token-bearing paths (/invite/<token>,
 *   /verify-email/<token>, /api/calendar/feed/<token>) and Netlify hook ids;
 * - key=value / "key": "value" pairs whose key names a secret;
 * - long hex or base64 runs (hashes, raw keys, ciphertext).
 */

const REDACTED = "[redacted]";

const PATTERNS: Array<[RegExp, string | ((m: string, ...g: string[]) => string)]> = [
  // Credentials inside URLs: scheme://user:password@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, "$1[redacted]@"],
  // Query strings and fragments of absolute URLs (signatures, tokens, codes).
  [/\b(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/gi, "$1?[redacted]"],
  // The app's token-bearing paths.
  [/(\/(?:invite|verify-email|api\/calendar\/feed)\/)[^/?#\s"'<>]+/gi, "$1[redacted]"],
  [/(api\.netlify\.com\/build_hooks\/)[A-Za-z0-9]+/gi, "$1[redacted]"],
  // Authorization header values.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, "$1 [redacted]"],
  // JWTs.
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, REDACTED],
  // Provider key shapes.
  [/\bsk-(?:ant-)?[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\b(?:re|rk|pk|sk|whsec)_[A-Za-z0-9_]{8,}/g, REDACTED],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, REDACTED],
  [/\bya29\.[0-9A-Za-z._-]{10,}/g, REDACTED],
  [/\b1\/\/0[0-9A-Za-z_-]{10,}/g, REDACTED],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}/g, REDACTED],
  [/\bgithub_pat_[A-Za-z0-9_]{16,}/g, REDACTED],
  [/\bxox[abprs]-[A-Za-z0-9-]{8,}/g, REDACTED],
  [/\bvercel_blob_rw_[A-Za-z0-9_]{8,}/g, REDACTED],
  // key=value and "key": "value" where the key names a secret.
  [
    /\b((?:[a-z0-9_-]*?)(?:secret|token|password|passwd|pwd|api[_-]?key|apikey|authorization|cookie|signature|kek|dek|credential|private[_-]?key)[a-z0-9_-]*)(\s*["']?\s*[:=]\s*["']?)([^\s"',;&}]+)/gi,
    "$1$2[redacted]",
  ],
  // Email addresses.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  // Long hex runs (sha256 digests, raw keys).
  [/\b[0-9a-f]{32,}\b/gi, REDACTED],
  // Long base64/base64url runs that look random (mixed case plus digits),
  // not file paths or identifiers in stack traces.
  [/[A-Za-z0-9+/_-]{40,}={0,2}/g, (m: string) => (looksRandom(m) ? REDACTED : m)],
];

function looksRandom(run: string): boolean {
  const slashes = run.split("/").length - 1;
  return slashes <= 2 && /[0-9]/.test(run) && /[a-z]/.test(run) && /[A-Z]/.test(run);
}

/** Redacts secrets and email addresses from `text` (see the module comment). */
export function redactText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PATTERNS) {
    out =
      typeof replacement === "string"
        ? out.replace(pattern, replacement)
        : out.replace(pattern, replacement);
  }
  return out;
}

/** Object keys whose values are always dropped by redactValue. */
export const SENSITIVE_KEY =
  /secret|token|password|passwd|api[-_]?key|apikey|authorization|cookie|set-cookie|signature|kek|dek|credential|private[-_]?key|ciphertext|refresh/i;

/**
 * Deep copy of `value` with sensitive keys dropped and every string passed
 * through redactText. Bounded in depth and size, so a huge or cyclic object
 * cannot stall a log call.
 */
export function redactValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return redactText(value);
  if (value === null || typeof value !== "object") return value;
  if (depth > 8) return "[depth]";
  if (seen.has(value)) return "[cycle]";
  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
      stack: value.stack ? redactText(value.stack) : undefined,
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((v) => redactValue(v, depth + 1, seen));
  }
  if (value instanceof Date) return value;

  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (n++ >= 200) break;
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redactValue(v, depth + 1, seen);
  }
  return out;
}

/** A one-line, redacted, length-bounded description of an error. */
export function describeError(error: unknown, max = 500): string {
  let text: string;
  if (error instanceof Error) {
    text = error.name && error.name !== "Error" ? `${error.name}: ${error.message}` : error.message;
  } else if (typeof error === "string") {
    text = error;
  } else {
    try {
      text = JSON.stringify(error) ?? String(error);
    } catch {
      text = String(error);
    }
  }
  const oneLine = redactText(text).replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}
