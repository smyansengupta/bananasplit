import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Shared authentication for every cron and job-drain route (0A Fix 5).
 *
 * Fails CLOSED: with no CRON_SECRET configured the route answers 503 and
 * does nothing (the old routes skipped the check entirely when the secret
 * was unset, so any visitor could trigger digests). A wrong or missing
 * `Authorization: Bearer <secret>` answers 401. The comparison is
 * constant-time over sha256 digests, so neither the secret's length nor a
 * matching prefix leaks through timing.
 *
 *   export async function GET(request: Request) {
 *     const denied = assertCronAuth(request);
 *     if (denied) return denied;
 *     ...
 *   }
 */
export function assertCronAuth(
  request: Pick<Request, "headers">,
  env: Record<string, string | undefined> = process.env,
): Response | null {
  const secret = env.CRON_SECRET;
  if (!secret) {
    return new Response("Cron is not configured", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!provided || !safeEqual(provided, secret)) {
    return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  return null;
}

/** Whether the request carries the cron secret (for optional detail, never for access). */
export function hasCronAuth(
  request: Pick<Request, "headers">,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return assertCronAuth(request, env) === null;
}

function safeEqual(a: string, b: string): boolean {
  const da = createHash("sha256").update(a).digest();
  const db = createHash("sha256").update(b).digest();
  return timingSafeEqual(da, db);
}
