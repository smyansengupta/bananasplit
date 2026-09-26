/**
 * The app's absolute origin for links that leave the browser: emails, the
 * ICS feed, verification and invitation links, job kicks. Never derived from
 * the request's Host header, which the client controls (0A Fix 7).
 *
 * - Previews (VERCEL_ENV=preview): https://$VERCEL_URL, the deployment's own
 *   URL, so preview mail never links to production.
 * - Otherwise NEXT_PUBLIC_APP_URL (required in production).
 * - Local fallback: http://localhost:3000.
 *
 * Returned without a trailing slash.
 */
export function appOrigin(env: Record<string, string | undefined> = process.env): string {
  if (env.VERCEL_ENV === "preview" && env.VERCEL_URL) {
    return `https://${env.VERCEL_URL.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  }
  const configured = env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    const url = new URL(configured);
    return url.origin;
  }
  return "http://localhost:3000";
}

/** An absolute URL for an app path ("/app/cbc/tasks" -> "https://.../app/cbc/tasks"). */
export function appUrl(path: string, env?: Record<string, string | undefined>): string {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new TypeError(`appUrl takes an absolute app path (got ${path})`);
  }
  return `${appOrigin(env)}${path}`;
}

/** Alias of appOrigin(), kept for the 0A call sites. */
export function appBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return appOrigin(env);
}

/** Like appUrl(), but also accepts a path without its leading slash. */
export function absoluteAppUrl(path: string, env?: Record<string, string | undefined>): string {
  return appUrl(path.startsWith("/") ? path : `/${path}`, env);
}
