"use server";

import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { parsePublicToken } from "@/lib/crm/quotes";
import { respondToQuote } from "@/server/crm/quotes";

/**
 * Accept (typed name) or decline a quote from its public link. No session:
 * the token is the credential, checked against its hash in its own
 * organization; rate-limited per link and per IP before anything changes.
 * The IP itself is never stored, only a hash of it with the organization.
 */

type Result = { ok: true; message: string } | { ok: false; error: string };

async function limited(token: string): Promise<Result | null> {
  const ip = await getClientIp();
  const a = await checkRateLimit(rateLimitKey("crm-quote-respond", token), 10, 3600);
  const b = await checkRateLimit(rateLimitKey("crm-quote-respond-ip", ip), 30, 3600);
  return a.allowed && b.allowed ? null : { ok: false, error: "Too many tries. Try again later." };
}

export async function acceptQuoteAction(token: string, name: string): Promise<Result> {
  if (typeof token !== "string" || !parsePublicToken(token)) return { ok: false, error: "This link isn't valid." };
  const stop = await limited(token);
  if (stop) return stop;
  return respondToQuote(token, { accept: true, name: String(name ?? "").slice(0, 200), ip: await getClientIp() });
}

export async function declineQuoteAction(token: string, reason: string): Promise<Result> {
  if (typeof token !== "string" || !parsePublicToken(token)) return { ok: false, error: "This link isn't valid." };
  const stop = await limited(token);
  if (stop) return stop;
  return respondToQuote(token, { accept: false, reason: String(reason ?? "").slice(0, 1000) });
}
