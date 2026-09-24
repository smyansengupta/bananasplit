import { NextResponse, type NextRequest } from "next/server";

import { NotFoundError } from "@/lib/auth/errors";
import { can } from "@/lib/auth/permissions";
import { getSession } from "@/lib/auth/session";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { withOrgTx } from "@/server/db/context";
import {
  OAUTH_COOKIE,
  STATE_TTL_MS,
  beginGoogleAuth,
  isGoogleConfigured,
} from "@/server/integrations/google";

/**
 * POST /api/integrations/google-calendar/start (form field `orgId`)
 *
 * OWNER/ADMIN only. Mints the PKCE verifier and the nonce (kept in a signed,
 * httpOnly cookie scoped to the callback path) and the signed state, then
 * sends the browser to Google's consent screen (303). POST, with a
 * same-origin check, so a prefetch or a cross-site link cannot start it.
 */
export const dynamic = "force-dynamic";

function isCrossSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== new URL(request.url).host;
  } catch {
    return true;
  }
}

function deny(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (isCrossSite(request)) return deny(403, "Forbidden.");
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/sign-in", request.url), 303);

  const form = await request.formData().catch(() => null);
  const orgId = form?.get("orgId");
  if (typeof orgId !== "string" || !orgId || orgId.length > 100)
    return deny(400, "Missing organization.");

  let slug: string;
  try {
    const found = await withOrgTx(orgId, async ({ db, role }) => {
      const org = await db.organization.findUniqueOrThrow({
        where: { id: orgId },
        select: { slug: true },
      });
      return { slug: org.slug, allowed: can({ role }, "integrations.write") };
    });
    if (!found.allowed) return deny(403, "Only owners and admins can connect Google Calendar.");
    slug = found.slug;
  } catch (error) {
    if (error instanceof NotFoundError) return deny(404, "Not found.");
    throw error;
  }

  const back = new URL(`/app/${slug}/settings/integrations/google-calendar`, request.url);
  if (!isGoogleConfigured()) {
    back.searchParams.set("google", "not_configured");
    return NextResponse.redirect(back, 303);
  }
  const limited = await checkRateLimit(rateLimitKey("gcal-connect", orgId), 20, 60 * 60);
  if (!limited.allowed) {
    back.searchParams.set("google", "rate_limited");
    return NextResponse.redirect(back, 303);
  }

  const { url, cookie } = beginGoogleAuth(orgId, session.user.id);
  const res = NextResponse.redirect(url, 303);
  res.headers.set("Cache-Control", "no-store");
  res.cookies.set(OAUTH_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Lax: the callback is a top-level GET navigation back from Google.
    sameSite: "lax",
    path: "/api/integrations/google-calendar",
    maxAge: Math.floor(STATE_TTL_MS / 1000),
  });
  return res;
}
