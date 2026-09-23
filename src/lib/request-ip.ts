/**
 * The client IP for rate-limit keys.
 *
 * On Vercel, x-real-ip is set by the platform edge to the connecting client
 * and cannot be supplied by the client. The FIRST x-forwarded-for hop is
 * client-controlled (anyone can send "X-Forwarded-For: 1.2.3.4"), so it is
 * never used; when x-real-ip is absent (local dev, other hosts) the LAST
 * hop, the one added by the proxy nearest to us, is used instead.
 */

type HeaderSource = Pick<Headers, "get">;

const MAX_LENGTH = 64;

export function clientIpFrom(headers: HeaderSource): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, MAX_LENGTH);

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    const last = hops[hops.length - 1];
    if (last) return last.slice(0, MAX_LENGTH);
  }
  return "unknown";
}

/** The client IP of the current request (Server Actions, route handlers). */
export async function getClientIp(): Promise<string> {
  const { headers } = await import("next/headers");
  return clientIpFrom(await headers());
}
