import { NextResponse, type NextRequest } from "next/server";

import { NotFoundError } from "@/lib/auth/errors";
import { can } from "@/lib/auth/permissions";
import { getSession } from "@/lib/auth/session";
import { isCrossSite } from "@/lib/http/cross-site";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { withOrgTx } from "@/server/db/context";
import { providerFromSlug, returnPath } from "@/server/conference/connect";
import { STATE_TTL_MS, beginAuth, oauthCookieName } from "@/server/conference/oauth";
import { isConfigured } from "@/server/conference/providers";

/**
 * POST /api/integrations/conference/{google-meet|zoom|microsoft-teams}/start
 * (form field `orgId`)
 *
 * OWNER/ADMIN only. Mints the PKCE verifier and the nonce (kept in a signed,
 * httpOnly cookie scoped to this provider's callback path) and the signed
 * state, then sends the browser to the provider's consent screen (303). POST
 * with a same-origin check, so a prefetch or a cross-site link cannot start
 * it. Modelled on the Google Calendar start route next door.
 */
export const dynamic = "force-dynamic";

function deny(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  if (isCrossSite(request)) return deny(403, "Forbidden.");
  const { provider: slug } = await context.params;
  const def = providerFromSlug(slug);
  if (!def) return deny(404, "Not found.");

  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/sign-in", request.url), 303);

  const form = await request.formData().catch(() => null);
  const orgId = form?.get("orgId");
  if (typeof orgId !== "string" || !orgId || orgId.length > 100)
    return deny(400, "Missing organization.");

  let slugOfOrg: string;
  try {
    const found = await withOrgTx(orgId, async ({ db, role }) => {
      const org = await db.organization.findUniqueOrThrow({
        where: { id: orgId },
        select: { slug: true },
      });
      return { slug: org.slug, allowed: can({ role }, "integrations.write") };
    });
    if (!found.allowed)
      return deny(403, `Only owners and admins can connect ${def.label}.`);
    slugOfOrg = found.slug;
  } catch (error) {
    if (error instanceof NotFoundError) return deny(404, "Not found.");
    throw error;
  }

  const back = new URL(returnPath(slugOfOrg, def), request.url);
  if (!isConfigured(def)) {
    back.searchParams.set("conference", "not_configured");
    return NextResponse.redirect(back, 303);
  }
  const limited = await checkRateLimit(
    rateLimitKey("conference-connect", def.integration, orgId),
    20,
    60 * 60,
  );
  if (!limited.allowed) {
    back.searchParams.set("conference", "rate_limited");
    return NextResponse.redirect(back, 303);
  }

  const { url, cookie } = beginAuth(def, orgId, session.user.id);
  const res = NextResponse.redirect(url, 303);
  res.headers.set("Cache-Control", "no-store");
  res.cookies.set(oauthCookieName(def), cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Lax: the callback is a top-level GET navigation back from the provider.
    sameSite: "lax",
    path: `/api/integrations/conference/${slug}`,
    maxAge: Math.floor(STATE_TTL_MS / 1000),
  });
  return res;
}
