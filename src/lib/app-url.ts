/**
 * The app's absolute origin for links that leave the browser: emails, the
 * ICS feed, verification and invitation links, job kicks. Never derived from
 * the request's Host header, which the client controls (0A Fix 7).
 *
 * - Previews (VERCEL_ENV=preview): https://$VERCEL_URL, the deployment's own
 *   URL, so preview mail never links to production.
 * - Otherwise NEXT_PUBLIC_APP_URL, when set (in production it must not be
 *   a localhost address: AppUrlConfigError).
 * - Production (VERCEL_ENV=production) without it:
 *   https://$VERCEL_PROJECT_PRODUCTION_URL, Vercel's system variable for the
 *   project's production domain (the shortest custom domain, else the
 *   vercel.app one; set at build and run time, without the scheme). With
 *   neither set, AppUrlConfigError: a production link never points at
 *   localhost, so an email job fails with that message as its lastError
 *   instead of sending a link nobody can open.
 * - Local fallback (not on Vercel): http://localhost:3000.
 *
 * Returned without a trailing slash.
 */

/** Production has no usable app origin (see appOrigin). */
export class AppUrlConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppUrlConfigError";
  }
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}

/** `host` or `https://host/` as https://host (a bare Vercel domain variable). */
function httpsOrigin(host: string): string {
  return `https://${host.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
}

export function appOrigin(env: Record<string, string | undefined> = process.env): string {
  if (env.VERCEL_ENV === "preview" && env.VERCEL_URL) {
    return httpsOrigin(env.VERCEL_URL);
  }
  const production = env.VERCEL_ENV === "production";
  const configured = env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    const url = new URL(configured);
    if (production && isLoopback(url.hostname)) {
      throw new AppUrlConfigError(
        "NEXT_PUBLIC_APP_URL points at localhost in production: set it to the production URL, or remove it to use VERCEL_PROJECT_PRODUCTION_URL.",
      );
    }
    return url.origin;
  }
  if (production) {
    const productionHost = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
    if (productionHost) return new URL(httpsOrigin(productionHost)).origin;
    throw new AppUrlConfigError(
      "No app URL in production: set NEXT_PUBLIC_APP_URL, or enable Vercel's system environment variables so VERCEL_PROJECT_PRODUCTION_URL is available.",
    );
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
