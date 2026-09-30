/**
 * Security headers and Content Security Policy (0A Fix 13, decision D7).
 *
 * Two policies:
 * - NONCE policy, set per request by src/proxy.ts on the authenticated and
 *   form surfaces: /app, /poll, /invite and the auth pages (/sign-in,
 *   /sign-up, /verify-email, /onboarding). Scripts run only with the
 *   request's nonce ('strict-dynamic' lets those scripts load Next's
 *   chunks). Nonces force dynamic rendering, which these routes are anyway.
 * - STATIC policy, from next.config.ts headers, on every other route (/,
 *   public pages and feeds) so they can stay statically rendered: the
 *   Next.js guide's "without nonces" form, script-src 'self' 'unsafe-inline'.
 *
 * Styles: style-src 'self' 'unsafe-inline' in both, with no style nonce and
 * no style-src-attr. A style nonce would make browsers ignore
 * 'unsafe-inline', and the app server-renders style attributes (label
 * colors, progress bars, the kanban drag transform), React's hoisted
 * <style> and the Phase 8 theme <style>. Same as the club website.
 *
 * Mode: the policy is ENFORCED unless CSP_MODE=report-only says otherwise.
 * It used to default to report-only in production whenever CSP_MODE was
 * unset, which is the one environment that needs it enforced: a missing or
 * misspelt variable, or a new deployment target nobody set it on, shipped a
 * policy browsers only report on. Reports still go to /api/csp-report, and
 * CSP_MODE=report-only is the deliberate, visible way to run a new policy
 * for a week before turning it on.
 *
 * Contract for later phases: a server-rendered <script> on a nonce route
 * takes nonce={await getNonce()} (src/lib/security/nonce.ts), JSON-LD
 * included. A <style> needs no nonce.
 */

// Relative, not "@/...": next.config.ts loads this file too.
import { collabConfig } from "../collab/config";

export type CspMode = "enforce" | "report-only";

/** Paths under the nonce policy (the proxy matcher lists the same set). */
export const NONCE_ROUTE_PREFIXES = [
  "/app",
  "/poll",
  "/invite",
  "/sign-in",
  "/sign-up",
  "/verify-email",
  "/onboarding",
] as const;

export function isNonceRoute(pathname: string): boolean {
  return NONCE_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export const CSP_REPORT_PATH = "/api/csp-report";

export function cspMode(env: NodeJS.ProcessEnv = process.env): CspMode {
  return env.CSP_MODE === "report-only" ? "report-only" : "enforce";
}

export function cspHeaderName(mode: CspMode): string {
  return mode === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";
}

/** The Sentry ingest origin from the DSN, if reporting is configured. */
export function sentryOrigin(env: NodeJS.ProcessEnv = process.env): string | null {
  const dsn = env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/** Vercel Blob's public store (logos, avatars) and Google profile photos. */
const IMAGE_HOSTS = [
  "https://*.public.blob.vercel-storage.com",
  "https://*.googleusercontent.com",
];

/** The Google sign-in form POST redirects to accounts.google.com. */
const FORM_TARGETS = ["https://accounts.google.com"];

interface PolicyOptions {
  env?: NodeJS.ProcessEnv;
}

function sharedDirectives(env: NodeJS.ProcessEnv): string[] {
  const isProduction = env.NODE_ENV === "production";
  const connect = [
    "'self'",
    sentryOrigin(env),
    // The live-collaboration WebSocket, only while collaboration is on
    // (docs/features/collaboration.md).
    collabConfig(env)?.origin,
  ].filter(Boolean);
  return [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${IMAGE_HOSTS.join(" ")}`,
    // FullCalendar ships its icon font inline as a data: URI in its CSS.
    "font-src 'self' data:",
    `connect-src ${connect.join(" ")}`,
    `form-action 'self' ${FORM_TARGETS.join(" ")}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    ...(isProduction ? ["upgrade-insecure-requests"] : []),
    `report-uri ${CSP_REPORT_PATH}`,
    "report-to csp-endpoint",
  ];
}

/** The per-request policy for the nonce routes. */
export function buildNonceCsp(nonce: string, { env = process.env }: PolicyOptions = {}): string {
  const isDev = env.NODE_ENV === "development";
  const script = `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`;
  const [defaultSrc, ...rest] = sharedDirectives(env);
  return [defaultSrc, script, ...rest].join("; ");
}

/** The static policy for every other route (no nonce, so pages can be static). */
export function buildStaticCsp({ env = process.env }: PolicyOptions = {}): string {
  const isDev = env.NODE_ENV === "development";
  const script = `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`;
  const [defaultSrc, ...rest] = sharedDirectives(env);
  return [defaultSrc, script, ...rest].join("; ");
}

/** 128 bits from the Web Crypto API (the proxy may run outside Node). */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Where browsers send report-to reports (paired with the report-to directive). */
export const REPORTING_ENDPOINTS_HEADER = {
  key: "Reporting-Endpoints",
  value: `csp-endpoint="${CSP_REPORT_PATH}"`,
};

/** Static security headers for every route (next.config.ts). */
export const STATIC_SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
];

/**
 * X-Frame-Options: DENY, on every path except the Notes files route, whose
 * PDFs the in-app preview shows in a same-origin frame (that route sends
 * SAMEORIGIN and its own frame-ancestors 'self').
 */
export const FRAME_DENY_HEADER = { key: "X-Frame-Options", value: "DENY" };
const FRAMABLE = "api/orgs/[^/]+/files/";
export const NOT_FRAMABLE_SOURCE = `/((?!${FRAMABLE}).*)`;

/**
 * next.config.ts `source` for the static CSP: every path EXCEPT the nonce
 * routes (so a matched route never carries two policies).
 */
export const STATIC_CSP_SOURCE =
  `/((?!app/|app$|poll/|poll$|invite/|invite$|sign-in|sign-up|verify-email|onboarding|${FRAMABLE}).*)`;
