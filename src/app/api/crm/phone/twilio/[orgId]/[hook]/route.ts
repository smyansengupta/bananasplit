import { NextResponse } from "next/server";

import { appUrl } from "@/lib/app-url";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { clientIpFrom } from "@/lib/request-ip";
import { webhookSecret } from "@/server/crm/phone/connection";
import {
  EMPTY_TWIML,
  twilioNotice,
  twilioRecording,
  twilioSms,
  twilioStatus,
  twilioVoice,
} from "@/server/crm/phone/inbound";
import { formParams, verifyTwilio } from "@/server/crm/phone/signatures";

/**
 * Twilio's webhooks for one organization: voice (the softphone's outgoing
 * call, answered with TwiML), notice (played to the person before a
 * recorded call connects), status, recording, and sms (texts in and
 * delivery reports). In order: X-Twilio-Signature (HMAC-SHA1 of our own
 * public URL and the form, under the organization's auth token), a per-
 * organization rate limit, then the hook in that organization only.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ORG = /^[A-Za-z0-9_-]{1,64}$/;
const HOOKS = new Set(["voice", "notice", "status", "recording", "sms"]);

function twiml(body: string): NextResponse {
  return new NextResponse(body, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
}

export async function POST(request: Request, ctx: { params: Promise<{ orgId: string; hook: string }> }) {
  const { orgId, hook } = await ctx.params;
  if (!ORG.test(orgId) || !HOOKS.has(hook)) return new NextResponse(null, { status: 404 });
  const raw = await request.text();
  if (raw.length > 64 * 1024) return new NextResponse(null, { status: 413 });
  const params = formParams(raw);
  const requested = new URL(request.url);
  // Twilio signs the address it called: ours, as configured, not the proxy's.
  const url = appUrl(`${requested.pathname}${requested.search}`);
  const authToken = await webhookSecret(orgId, "twilio");
  if (!verifyTwilio({ url, params, signature: request.headers.get("x-twilio-signature"), authToken })) {
    await checkRateLimit(rateLimitKey("crm-phone-bad", clientIpFrom(request.headers)), 60, 600);
    return new NextResponse(null, { status: 401 });
  }
  const limited = await checkRateLimit(rateLimitKey("crm-phone-hook", orgId), 1200, 60);
  if (!limited.allowed) return new NextResponse(null, { status: 429 });
  try {
    switch (hook) {
      case "voice":
        return twiml(await twilioVoice(orgId, params));
      case "notice":
        return twiml(await twilioNotice(orgId, requested.searchParams.get("call")));
      case "status":
        await twilioStatus(orgId, params);
        return twiml(EMPTY_TWIML);
      case "recording":
        await twilioRecording(orgId, params);
        return twiml(EMPTY_TWIML);
      default:
        await twilioSms(orgId, params);
        return twiml(EMPTY_TWIML);
    }
  } catch (error) {
    console.error(`[crm:twilio] ${hook} failed`, error instanceof Error ? error.name : "error");
    return new NextResponse(null, { status: 500 });
  }
}
