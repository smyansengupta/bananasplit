import { createHash } from "node:crypto";

import { authDb, serviceDb } from "@/server/db/clients";

/**
 * Fixed-window rate limiter backed by Postgres ('Rate limiting' decision).
 *
 * The state lives in RateLimitBucket, which no runtime role can read or
 * write; the only path is the SECURITY DEFINER function
 * app.rate_limit_hit(key, limit, windowSeconds), executable by app_service
 * and app_auth only (attack N6: request code cannot exhaust another
 * principal's bucket, such as a sign-in lockout).
 *
 * Each call is its OWN autocommit statement on the service (or auth) pool,
 * never inside ctx.db, so a rolled-back action still counts, and every
 * serverless instance shares the same counters.
 *
 * Keys: build them with rateLimitKey(scope, ...parts). Identifying parts
 * (emails, IPs, tokens) are hashed, so the bucket table holds no personal
 * data or credentials. Windows are at most 30 days (the maintenance job
 * prunes buckets older than 40 days).
 *
 * Failure policy: if the database call fails the request is allowed and the
 * error is logged. The limiter is a secondary control; failing closed would
 * turn a database blip into a sign-in outage for everyone.
 */

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
}

export interface RateLimitOptions {
  /** app_auth for the credentials sign-in and sign-up paths; app_service otherwise. */
  via?: "service" | "auth";
}

export const MAX_WINDOW_SECONDS = 30 * 24 * 60 * 60;

/** Test seam: the SQL call, replaceable in unit tests. */
export const rateLimitBackend = {
  async hit(
    key: string,
    limit: number,
    windowSec: number,
    via: "service" | "auth",
  ): Promise<{ allowed: boolean; retryAfterMs: number }> {
    const client = via === "auth" ? authDb : serviceDb;
    const rows = await client.$queryRaw<{ allowed: boolean; retry_after_ms: bigint | number }[]>`
      SELECT allowed, retry_after_ms FROM app.rate_limit_hit(${key}, ${limit}::int, ${windowSec}::int)`;
    const row = rows[0];
    return { allowed: row?.allowed ?? true, retryAfterMs: Number(row?.retry_after_ms ?? 0) };
  },
};

/**
 * A bucket key: `scope:part1:part2`. Parts are hashed (sha256, 24 hex
 * characters) so emails, IPs and tokens never reach the table in clear.
 * Parts are trimmed; normalize emails (lower-case) before passing them.
 */
export function rateLimitKey(scope: string, ...parts: string[]): string {
  if (!/^[a-z][a-z0-9._-]{0,63}$/.test(scope)) {
    throw new TypeError(`rate limit scope must be a short lowercase name (got ${scope})`);
  }
  const hashed = parts.map((p) =>
    createHash("sha256").update(p.trim()).digest("hex").slice(0, 24),
  );
  return [scope, ...hashed].join(":");
}

/**
 * Counts one hit on `key` and says whether it is within `limit` hits per
 * `windowSec` seconds.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSec: number,
  options: RateLimitOptions = {},
): Promise<RateLimitResult> {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("limit must be a positive integer");
  if (!Number.isInteger(windowSec) || windowSec < 1 || windowSec > MAX_WINDOW_SECONDS) {
    throw new RangeError(`windowSec must be an integer between 1 and ${MAX_WINDOW_SECONDS}`);
  }
  if (key.length === 0 || key.length > 200) throw new RangeError("rate limit key must be 1-200 characters");

  try {
    const { allowed, retryAfterMs } = await rateLimitBackend.hit(
      key,
      limit,
      windowSec,
      options.via ?? "service",
    );
    return allowed ? { allowed: true } : { allowed: false, retryAfterMs: Math.max(0, retryAfterMs) };
  } catch (error) {
    console.error(
      `[rate-limit] ${key.split(":")[0]}: limiter unavailable, allowing the request`,
      error instanceof Error ? error.message : error,
    );
    return { allowed: true };
  }
}

/** "Try again in N minutes" copy for a limited request. */
export function retryAfterText(result: RateLimitResult): string {
  const minutes = Math.max(1, Math.ceil((result.retryAfterMs ?? 60_000) / 60_000));
  if (minutes === 1) return "in a minute";
  if (minutes < 90) return `in ${minutes} minutes`;
  const hours = Math.ceil(minutes / 60);
  return hours < 36 ? `in ${hours} hours` : `in ${Math.ceil(hours / 24)} days`;
}
