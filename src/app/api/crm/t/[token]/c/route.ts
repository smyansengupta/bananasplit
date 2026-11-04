import { NextResponse } from "next/server";

import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { recordTracking } from "@/server/crm/outreach/public";
import { checkClick } from "@/server/crm/outreach/tokens";

/**
 * A tracked link in a CRM email: records the click, then sends the reader
 * where the member linked. The destination is signed with the message's
 * token (tokens.ts), so this is never an open redirect: an unsigned or
 * altered URL goes nowhere.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const url = new URL(request.url);
  const to = url.searchParams.get("u") ?? "";
  const sig = url.searchParams.get("s") ?? "";
  let dest: URL;
  try {
    dest = new URL(to);
  } catch {
    return new NextResponse("This link isn't working.", { status: 400 });
  }
  if ((dest.protocol !== "https:" && dest.protocol !== "http:") || !/^[a-f0-9]{24}$/.test(token) || !checkClick(token, to, sig)) {
    return new NextResponse("This link isn't working.", { status: 400 });
  }
  const limited = await checkRateLimit(rateLimitKey("crm-click", token), 60, 3600);
  if (limited.allowed) await recordTracking(token, "click", to).catch(() => false);
  return NextResponse.redirect(dest.toString(), { status: 302, headers: { "Cache-Control": "no-store" } });
}
