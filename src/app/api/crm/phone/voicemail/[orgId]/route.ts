import { NextResponse } from "next/server";

import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { verifyAudioLink } from "@/server/crm/phone/audio";
import { phoneStatus } from "@/server/crm/phone/connection";
import { getBlob } from "@/server/storage";

/**
 * The organization's recorded voicemail, fetched by Telnyx or Twilio while
 * dropping it into a call: no session, so a ten-minute signed link that
 * names the organization and the file, and only the file that is the
 * organization's current voicemail.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await ctx.params;
  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? "";
  const t = url.searchParams.get("t") ?? "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(orgId) || !key.startsWith(`crm-audio/${orgId}/voicemail/`) || !verifyAudioLink(orgId, key, t)) {
    return new NextResponse(null, { status: 404 });
  }
  const limited = await checkRateLimit(rateLimitKey("crm-voicemail", orgId), 120, 60);
  if (!limited.allowed) return new NextResponse(null, { status: 429 });
  const status = await phoneStatus(orgId);
  if (status.settings.voicemailKey !== key) return new NextResponse(null, { status: 404 });
  const blob = await getBlob(key);
  if (!blob) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(blob.body), {
    headers: { "Content-Type": blob.contentType, "Cache-Control": "private, no-store" },
  });
}
