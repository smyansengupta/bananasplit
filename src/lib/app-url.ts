/**
 * The absolute origin for links that leave the app: calendar feed URLs,
 * verification and invitation links. Never derived from the request's Host
 * header, which the client controls (0A Fix 7).
 *
 * - Vercel previews: https://$VERCEL_URL (each preview has its own host).
 * - Everywhere else: NEXT_PUBLIC_APP_URL.
 * - Local fallback: http://localhost:3000.
 *
 * Returned without a trailing slash.
 */
export function appBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw =
    env.VERCEL_ENV === "preview" && env.VERCEL_URL
      ? `https://${env.VERCEL_URL}`
      : env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

/** `path` (starting with "/") resolved against appBaseUrl(). */
export function absoluteAppUrl(path: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${appBaseUrl(env)}${path.startsWith("/") ? path : `/${path}`}`;
}
