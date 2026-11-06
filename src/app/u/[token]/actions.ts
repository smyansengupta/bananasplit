"use server";

import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { applyUnsubscribe } from "@/server/crm/outreach/public";

/** Unsubscribing (or coming back) from the page in an email's footer. */
export async function setSubscriptionAction(token: string, subscribed: boolean): Promise<{ ok: boolean }> {
  const limited = await checkRateLimit(rateLimitKey("crm-unsub", await getClientIp()), 30, 600);
  if (!limited.allowed) return { ok: false };
  return { ok: await applyUnsubscribe(token, subscribed).catch(() => false) };
}
