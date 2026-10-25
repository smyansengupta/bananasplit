import { NextResponse, type NextRequest } from "next/server";

import { getSession } from "@/lib/auth/session";
import { CAPSULE_COOKIE, isCapsuleVariant } from "@/lib/shell/capsule-variant";

/**
 * TEMPORARY. Picks which shape the floating bar takes, so the three
 * candidates can be clicked through side by side on a preview
 * (capsule-variants.tsx).
 *
 * A layout cannot read search params, so the choice is a cookie and this
 * route is what sets it. It goes, along with two of the three variants, as
 * soon as one is chosen.
 *
 * GET /api/capsule?v=context&to=/app/my-club
 */
export const dynamic = "force-dynamic";

/** A 303 to a path on this same host, whatever host that is. */
function seeOther(path: string): NextResponse {
  // Not NextResponse.redirect(new URL(path, request.url)): request.url is the
  // address the server bound to, so on a preview served at a custom hostname
  // that rewrites the host and drops the session cookie with it.
  return new NextResponse(null, {
    status: 303,
    headers: { Location: path, "Cache-Control": "no-store" },
  });
}

export async function GET(request: NextRequest) {
  // Signed in only: this changes nothing but a cookie, and there is nothing
  // to look at signed out.
  if (!(await getSession())) return seeOther("/sign-in");

  const url = new URL(request.url);
  const variant = url.searchParams.get("v");
  // Same-origin paths only, so this cannot be used to bounce someone away.
  const to = url.searchParams.get("to");
  const target = to && to.startsWith("/") && !to.startsWith("//") ? to : "/app";

  const res = seeOther(target);
  if (isCapsuleVariant(variant)) {
    res.cookies.set(CAPSULE_COOKIE, variant, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 14,
    });
  } else {
    res.cookies.set(CAPSULE_COOKIE, "", { path: "/", maxAge: 0 });
  }
  return res;
}
