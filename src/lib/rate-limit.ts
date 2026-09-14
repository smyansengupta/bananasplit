/**
 * Fixed-window rate limiter (spec 6.2) for invite sends, poll responses,
 * receipt uploads, and the public ICS feed — the endpoints most exposed to
 * abuse because they're either public or fan out an email per call.
 *
 * This is an in-memory, per-process store. It's correct for a single long-
 * lived server (this dev setup, or a traditional always-on Node host) but
 * NOT for multiple serverless instances, which don't share memory — each
 * instance would track its own count, so the real limit becomes
 * (limit * instance count). A production deploy on Vercel needs a shared
 * store (Upstash Redis is the standard pairing) behind this same interface;
 * swap the implementation, not every call site.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
}

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (bucket.count >= limit) {
    return { allowed: false, retryAfterMs: bucket.resetAt - now };
  }

  bucket.count += 1;
  return { allowed: true };
}
