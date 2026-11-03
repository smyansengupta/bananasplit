import { NextResponse } from "next/server";

import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { clientIpFrom } from "@/lib/request-ip";
import { webhookSecret } from "@/server/crm/phone/connection";
import { handleTelnyxEvent } from "@/server/crm/phone/inbound";
import { verifyTelnyx } from "@/server/crm/phone/signatures";

/**
 * Telnyx's call and message events for one organization (the URL on its
 * Telnyx card). In order: the ed25519 signature against the organization's
 * own Telnyx public key (and a five-minute timestamp window), a per-
 * organization rate limit, then the event in that organization's context
 * only. A bad signature gets 401 and nothing is read or written.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ORG = /^[A-Za-z0-9_-]{1,64}$/;

export async function POST(request: Request, ctx: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await ctx.params;
  if (!ORG.test(orgId)) return new NextResponse(null, { status: 404 });
  const raw = await request.text();
  if (raw.length > 256 * 1024) return new NextResponse(null, { status: 413 });
  const publicKey = await webhookSecret(orgId, "telnyx");
  const ok = verifyTelnyx({
    rawBody: raw,
    signature: request.headers.get("telnyx-signature-ed25519"),
    timestamp: request.headers.get("telnyx-timestamp"),
    publicKey,
  });
  if (!ok) {
    await checkRateLimit(rateLimitKey("crm-phone-bad", clientIpFrom(request.headers)), 60, 600);
    return new NextResponse(null, { status: 401 });
  }
  const limited = await checkRateLimit(rateLimitKey("crm-phone-hook", orgId), 1200, 60);
  if (!limited.allowed) return new NextResponse(null, { status: 429 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  try {
    await handleTelnyxEvent(orgId, body);
  } catch (error) {
    console.error("[crm:telnyx] event failed", error instanceof Error ? error.name : "error");
    // A 5xx makes Telnyx retry, which is what a passing failure wants.
    return new NextResponse(null, { status: 500 });
  }
  return new NextResponse(null, { status: 200 });
}
