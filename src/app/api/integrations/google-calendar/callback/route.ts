import { NextResponse, type NextRequest } from "next/server";

import { getSession } from "@/lib/auth/session";
import { completeGoogleConnect } from "@/server/integrations/google-connect";
import { OAUTH_COOKIE } from "@/server/integrations/google";

/**
 * GET /api/integrations/google-calendar/callback?code=..&state=..
 *
 * Google's redirect after consent. All checks live in completeGoogleConnect
 * (signed state, single-use nonce cookie, same session user, OWNER/ADMIN,
 * granted scopes); the refresh token is stored as an encrypted OrgSecret and
 * never leaves the server. The nonce cookie is cleared on every outcome, so
 * a replayed callback URL fails.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const session = await getSession();
  const outcome = await completeGoogleConnect({
    state: url.searchParams.get("state"),
    code: url.searchParams.get("code"),
    error: url.searchParams.get("error"),
    cookie: request.cookies.get(OAUTH_COOKIE)?.value ?? null,
    sessionUserId: session?.user.id ?? null,
    signal: AbortSignal.timeout(20_000),
  });

  const target = outcome.orgSlug
    ? new URL(`/app/${outcome.orgSlug}/settings/integrations/google-calendar`, request.url)
    : new URL("/app", request.url);
  target.searchParams.set("google", outcome.ok ? "connected" : outcome.code);
  const res = NextResponse.redirect(target, 303);
  res.headers.set("Cache-Control", "no-store");
  res.cookies.set(OAUTH_COOKIE, "", { path: "/api/integrations/google-calendar", maxAge: 0 });
  return res;
}
