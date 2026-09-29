/**
 * Whether to offer "Continue with Google" (/sign-in, /invite/[token]).
 *
 * The Auth.js Google provider (src/lib/auth/config.ts) is always registered
 * and reads AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET. Without both, the button
 * only leads to Auth.js's "server configuration" error, so the pages show it
 * only when both are set to something other than whitespace. Read per request
 * (both pages render dynamically), so it follows the deployment's env. Pure:
 * pass an env to test it.
 */
export function googleSignInEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return Boolean(env.AUTH_GOOGLE_ID?.trim() && env.AUTH_GOOGLE_SECRET?.trim());
}
