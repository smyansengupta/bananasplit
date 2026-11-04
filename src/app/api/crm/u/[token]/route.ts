import { NextResponse } from "next/server";

import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { applyUnsubscribe } from "@/server/crm/outreach/public";

/**
 * One-click unsubscribe (RFC 8058): the List-Unsubscribe header of every
 * sequence, campaign and bulk email points here, and a mail app POSTs
 * "List-Unsubscribe=One-Click" with no cookies and no page. The signed
 * token names the organization and the person (tokens.ts). People who
 * click the link in the footer get the page at /u/{token} instead.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = await checkRateLimit(rateLimitKey("crm-unsub", await getClientIp()), 30, 600);
  if (!limited.allowed) return new NextResponse("Too many requests", { status: 429 });
  const ok = await applyUnsubscribe(token).catch(() => false);
  return new NextResponse(ok ? "Unsubscribed" : "Not found", {
    status: ok ? 200 : 404,
    headers: { "Cache-Control": "no-store" },
  });
}
