import { NextResponse, type NextRequest } from "next/server";

import { getSession } from "@/lib/auth/session";
import { completeConferenceConnect, providerFromSlug, returnPath } from "@/server/conference/connect";
import { oauthCookieName } from "@/server/conference/oauth";

/**
 * GET /api/integrations/conference/{provider}/callback?code=..&state=..
 *
 * The provider's redirect after consent. Every check lives in
 * completeConferenceConnect (signed state bound to this provider, single-use
 * nonce cookie, same session user, OWNER/ADMIN, granted scopes); the refresh
 * token is stored as an encrypted OrgSecret and never leaves the server. The
 * nonce cookie is cleared on every outcome, so a replayed callback URL fails.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider: slug } = await context.params;
  const def = providerFromSlug(slug);
  if (!def) return NextResponse.redirect(new URL("/app", request.url), 303);

  const url = new URL(request.url);
  const session = await getSession();
  const outcome = await completeConferenceConnect({
    provider: def,
    state: url.searchParams.get("state"),
    code: url.searchParams.get("code"),
    error: url.searchParams.get("error"),
    cookie: request.cookies.get(oauthCookieName(def))?.value ?? null,
    sessionUserId: session?.user.id ?? null,
    signal: AbortSignal.timeout(20_000),
  });

  const target = outcome.orgSlug
    ? new URL(returnPath(outcome.orgSlug, def), request.url)
    : new URL("/app", request.url);
  target.searchParams.set("conference", outcome.ok ? "connected" : outcome.code);
  const res = NextResponse.redirect(target, 303);
  res.headers.set("Cache-Control", "no-store");
  res.cookies.set(oauthCookieName(def), "", {
    path: `/api/integrations/conference/${slug}`,
    maxAge: 0,
  });
  return res;
}
