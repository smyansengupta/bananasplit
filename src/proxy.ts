import { NextResponse, type NextRequest } from "next/server";

import { CALLBACK_HEADER } from "@/lib/auth/callback-url";
import {
  buildNonceCsp,
  cspHeaderName,
  cspMode,
  generateNonce,
  REPORTING_ENDPOINTS_HEADER,
} from "@/lib/security/csp";

/**
 * Per-request nonce Content Security Policy (0A Fix 13) for the
 * authenticated and form surfaces. Every other route gets the static policy
 * from next.config.ts. See src/lib/security/csp.ts for the directives.
 *
 * The nonce travels to rendering in the request headers: Next.js reads it
 * from the request's CSP header and stamps its own scripts, and x-nonce is
 * what getNonce() returns to server components (the theme script, JSON-LD).
 *
 * This is a security header only. Authorization happens in each page,
 * action and route handler, never here: a matcher change can silently drop
 * a path, and Server Actions post to the page's own path.
 */
export function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const policy = buildNonceCsp(nonce);
  const headerName = cspHeaderName(cspMode());

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(headerName, policy);
  // The requested path, so requireUser can send a signed-out visitor to
  // /sign-in?callbackUrl=... and back (validated there as same-origin
  // relative). Always overwritten, never trusted from the client here.
  requestHeaders.set(CALLBACK_HEADER, `${request.nextUrl.pathname}${request.nextUrl.search}`);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(headerName, policy);
  response.headers.set(REPORTING_ENDPOINTS_HEADER.key, REPORTING_ENDPOINTS_HEADER.value);
  return response;
}

// Prefetches are skipped (content-security-policy.md): they return RSC
// payloads, not documents, and would only burn a nonce. The matcher must be
// literal (Next analyzes it statically), hence the repetition. Keep it in
// step with NONCE_ROUTE_PREFIXES and STATIC_CSP_SOURCE in csp.ts.
export const config = {
  matcher: [
    {
      source: "/app",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
    {
      source: "/app/:path*",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
    {
      source: "/poll/:path*",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
    {
      source: "/invite/:path*",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
    {
      source: "/sign-in",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
    {
      source: "/sign-up",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
    {
      source: "/verify-email/:path*",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
    {
      source: "/onboarding",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
